/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma, PrismaClient } from '@prisma/client';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/infrastructure/config/env';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';
import { OUTPUT_TTL_MS } from '../../src/domain/video-view';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://video_svc:change-me@localhost:5432/fiapx?schema=video&connection_limit=5&sslmode=disable';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function startJwksServer(jwk: object): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind JWKS server');
  }
  return { server, url: `http://127.0.0.1:${address.port}/jwks.json` };
}

async function bootApp(jwksUrl: string): Promise<NestExpressApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    PORT: '3002',
    LOG_LEVEL: 'silent',
    DATABASE_URL,
    REDIS_URL,
    AWS_REGION: 'us-east-1',
    AWS_ENDPOINT: 'http://localhost:4566',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    OTEL_SERVICE_NAME: 'video-service',
    JWT_ISSUER: 'http://issuer.test',
    JWT_AUDIENCE: 'fiapx-api',
    JWKS_URL: jwksUrl,
    TRUST_GATEWAY_IP: 'false',
    S3_BUCKET: 'fiapx-local-videos',
    S3_PUBLIC_ENDPOINT: 'http://localhost:4566',
    VIDEO_PROCESS_QUEUE_URL: 'http://localhost:4566/000000000000/fiapx-local-video-process',
    VIDEO_STATUS_QUEUE_URL: 'http://localhost:4566/000000000000/fiapx-local-video-status-updates',
  });

  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    logger: false,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return app;
}

describe('GET /videos/:id/download (F3.7 / AC-50 / AC-51 / E-03)', () => {
  let app: NestExpressApplication;
  let jwksServer: Server;
  let privateKey: KeyLike;
  let redis: Redis;
  let prisma: PrismaClient;
  const userId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = 'f37-kid';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const started = await startJwksServer(jwk);
    jwksServer = started.server;
    app = await bootApp(started.url);
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
    await redis?.quit().catch(() => undefined);
    await new Promise<void>((resolve, reject) => {
      jwksServer?.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function signAccess(): Promise<string> {
    return new SignJWT({ sid: randomUUID() })
      .setProtectedHeader({ alg: 'RS256', kid: 'f37-kid' })
      .setSubject(userId)
      .setIssuer('http://issuer.test')
      .setAudience('fiapx-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  async function seedVideo(status: 'PENDING_UPLOAD' | 'COMPLETED', completedAt?: Date) {
    const id = randomUUID();
    await prisma.video.create({
      data: {
        id,
        userId,
        fileName: 'demo.mp4',
        contentType: 'video/mp4',
        sizeBytes: 100n,
        fps: new Prisma.Decimal(1),
        status,
        inputKey: `raw/${userId}/${id}.mp4`,
        outputKey: status === 'COMPLETED' ? `output/${userId}/${id}/frames.zip` : null,
        frameCount: status === 'COMPLETED' ? 3 : null,
        zipSizeBytes: status === 'COMPLETED' ? 40n : null,
        correlationId: randomUUID(),
        completedAt: status === 'COMPLETED' ? (completedAt ?? new Date()) : null,
      },
    });
    return id;
  }

  it('AC-51: non-COMPLETED → 409', async () => {
    const id = await seedVideo('PENDING_UPLOAD');
    const token = await signAccess();
    await request(app.getHttpServer())
      .get(`/videos/${id}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('AC-50: COMPLETED → 200 with public presigned GET url', async () => {
    const id = await seedVideo('COMPLETED', new Date());
    const token = await signAccess();
    const res = await request(app.getHttpServer())
      .get(`/videos/${id}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.url).toContain('localhost:4566');
    expect(res.body.url).toMatch(/response-content-disposition|X-Amz-Signature/i);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('E-03: past outputExpiresAt → 410', async () => {
    const old = new Date(Date.now() - OUTPUT_TTL_MS - 60_000);
    const id = await seedVideo('COMPLETED', old);
    const token = await signAccess();
    const res = await request(app.getHttpServer())
      .get(`/videos/${id}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(410);
    expect(res.body.status).toBe(410);
  });
});
