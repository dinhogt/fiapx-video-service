/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/infrastructure/config/env';
import { MAX_VIDEO_SIZE_BYTES } from '../../src/domain/video-file';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';

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

describe('POST /videos (F3.3 / AC-20 / D25)', () => {
  let app: NestExpressApplication;
  let jwksServer: Server;
  let privateKey: KeyLike;
  let redis: Redis;
  let prisma: PrismaClient;
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = 'f33-kid';
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
    const sid = randomUUID();
    return new SignJWT({ sid })
      .setProtectedHeader({ alg: 'RS256', kid: 'f33-kid' })
      .setSubject(userId)
      .setIssuer('http://issuer.test')
      .setAudience('fiapx-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  it('AC-20: size > 500 MB → 400 and no DB row', async () => {
    const before = await prisma.video.count();
    const token = await signAccess();

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'huge.mp4',
        sizeBytes: MAX_VIDEO_SIZE_BYTES + 1,
        contentType: 'video/mp4',
      });

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/500 MB/i);
    expect(await prisma.video.count()).toBe(before);
  });

  it('AC-20: invalid fps → 400 and no DB row', async () => {
    const before = await prisma.video.count();
    const token = await signAccess();

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'clip.mp4',
        sizeBytes: 100,
        contentType: 'video/mp4',
        fps: 0.05,
      });

    expect(res.status).toBe(400);
    expect(await prisma.video.count()).toBe(before);
  });

  it('creates PENDING_UPLOAD with presigned POST (server key, 15 min)', async () => {
    const token = await signAccess();

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .set('x-correlation-id', '33333333-3333-4333-8333-333333333333')
      .send({
        fileName: 'demo.mp4',
        sizeBytes: 2048,
        contentType: 'video/mp4',
        fps: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING_UPLOAD');
    expect(res.body.upload.method).toBe('POST');
    expect(res.body.upload.url).toContain('localhost:4566');
    expect(res.body.upload.fields.key).toMatch(
      new RegExp(`^raw/${userId}/${res.body.videoId}\\.mp4$`),
    );
    expect(res.body.upload.fields['Content-Type']).toBe('video/mp4');

    const policyJson = Buffer.from(res.body.upload.fields.Policy, 'base64').toString('utf8');
    expect(policyJson).toContain('content-length-range');
    expect(policyJson).toContain(String(MAX_VIDEO_SIZE_BYTES));

    const expiresAt = new Date(res.body.upload.expiresAt).getTime();
    expect(expiresAt - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000 + 5_000);

    const row = await prisma.video.findUnique({ where: { id: res.body.videoId } });
    expect(row?.status).toBe('PENDING_UPLOAD');
    expect(row?.userId).toBe(userId);
    expect(row?.inputKey).toBe(res.body.upload.fields.key);
  });
});
