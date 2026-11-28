/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
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

describe('GET /videos + GET /videos/:id (F3.6 / AC-40 / AC-80)', () => {
  let app: NestExpressApplication;
  let jwksServer: Server;
  let privateKey: KeyLike;
  let redis: Redis;
  let prisma: PrismaClient;
  const ownerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const otherId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = 'f36-kid';
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

  async function signAccess(sub: string): Promise<string> {
    return new SignJWT({ sid: randomUUID() })
      .setProtectedHeader({ alg: 'RS256', kid: 'f36-kid' })
      .setSubject(sub)
      .setIssuer('http://issuer.test')
      .setAudience('fiapx-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  async function createVideo(userId: string, fileName: string): Promise<string> {
    const token = await signAccess(userId);
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .set('x-correlation-id', randomUUID())
      .send({
        fileName,
        sizeBytes: 128,
        contentType: 'video/mp4',
      });
    expect(res.status).toBe(201);
    return res.body.videoId as string;
  }

  it('AC-40: lists only own videos with cursor pagination', async () => {
    const a = await createVideo(ownerId, 'own-a.mp4');
    const b = await createVideo(ownerId, 'own-b.mp4');
    const foreign = await createVideo(otherId, 'other.mp4');

    const token = await signAccess(ownerId);
    const page1 = await request(app.getHttpServer())
      .get('/videos')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).toEqual(expect.any(String));
    const firstId = page1.body.items[0].videoId as string;
    expect([a, b]).toContain(firstId);
    expect(page1.body.items[0].videoId).not.toBe(foreign);

    const page2 = await request(app.getHttpServer())
      .get('/videos')
      .query({ limit: 1, cursor: page1.body.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].videoId).not.toBe(firstId);
    expect(page2.body.items[0].videoId).not.toBe(foreign);

    const all = await request(app.getHttpServer())
      .get('/videos')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const ids = (all.body.items as Array<{ videoId: string }>).map((i) => i.videoId);
    expect(ids).toEqual(expect.arrayContaining([a, b]));
    expect(ids).not.toContain(foreign);
  });

  it('AC-80: GET /videos/:id returns 404 for non-owner', async () => {
    const videoId = await createVideo(ownerId, 'private.mp4');
    const otherToken = await signAccess(otherId);

    await request(app.getHttpServer())
      .get(`/videos/${videoId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);

    const ownerToken = await signAccess(ownerId);
    const ok = await request(app.getHttpServer())
      .get(`/videos/${videoId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(ok.body.videoId).toBe(videoId);
    expect(ok.body.fileName).toBe('private.mp4');
    expect(ok.body.status).toBe('PENDING_UPLOAD');
  });

  it('cache fail-open: listing still works when redis key ops succeed', async () => {
    const token = await signAccess(ownerId);
    await createVideo(ownerId, 'cached.mp4');
    const first = await request(app.getHttpServer())
      .get('/videos')
      .query({ limit: 5 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const second = await request(app.getHttpServer())
      .get('/videos')
      .query({ limit: 5 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(second.body.items.length).toBe(first.body.items.length);
  });
});
