import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';
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

describe('GET /metrics (F3.10 / ADR-011)', () => {
  let app: NestExpressApplication;
  let jwksServer: Server;
  let prisma: PrismaClient;
  let privateKey: KeyLike;
  const userId = '14141414-1414-4141-8141-141414141414';

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = 'f310-kid';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const started = await startJwksServer(jwk);
    jwksServer = started.server;
    app = await bootApp(started.url);
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
    await new Promise<void>((resolve, reject) => {
      jwksServer?.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function accessToken(): Promise<string> {
    return new SignJWT({ sid: randomUUID() })
      .setProtectedHeader({ alg: 'RS256', kid: 'f310-kid' })
      .setIssuer('http://issuer.test')
      .setAudience('fiapx-api')
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);
  }

  it('exposes videos_uploaded_total and outbox_* series', async () => {
    const token = await accessToken();
    const create = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'metrics.mp4',
        sizeBytes: 1024,
        contentType: 'video/mp4',
        fps: 1,
      });
    expect(create.status).toBe(201);

    await prisma.outbox.create({
      data: {
        id: randomUUID(),
        aggregateId: randomUUID(),
        type: 'video.process',
        destination: 'queue',
        payload: {},
        createdAt: new Date(Date.now() - 90_000),
        publishedAt: null,
      },
    });

    const metrics = await request(app.getHttpServer()).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('videos_uploaded_total');
    expect(metrics.text).toMatch(/videos_uploaded_total(?:\{[^}]*\})? [1-9]/);
    expect(metrics.text).toContain('videos_processed_total');
    expect(metrics.text).toContain('outbox_pending_total');
    expect(metrics.text).toMatch(/outbox_pending_total(?:\{[^}]*\})? [1-9]/);
    expect(metrics.text).toContain('outbox_oldest_pending_seconds');
    expect(metrics.text).toMatch(/outbox_oldest_pending_seconds(?:\{[^}]*\})? [1-9]/);
  });
});
