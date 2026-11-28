import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma, PrismaClient } from '@prisma/client';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';
import Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/infrastructure/config/env';
import { ExpirePendingUploadsJob } from '../../src/infrastructure/jobs/expire-pending-uploads.job';
import { HousekeepingJob } from '../../src/infrastructure/jobs/housekeeping.job';
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

describe('Jobs expire + housekeeping (F3.9 / controlled clock)', () => {
  let app: NestExpressApplication;
  let jwksServer: Server;
  let redis: Redis;
  let prisma: PrismaClient;
  const userId = '13131313-1313-4131-8131-131313131313';
  /** Fixed "now" for deterministic cutoffs (RF-15 / E-04). */
  const now = new Date('2026-11-28T12:00:00.000Z');

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = 'f39-kid';
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

  async function seedPending(createdAt: Date): Promise<string> {
    const id = randomUUID();
    await prisma.video.create({
      data: {
        id,
        userId,
        fileName: 'stale.mp4',
        contentType: 'video/mp4',
        sizeBytes: 10n,
        fps: new Prisma.Decimal(1),
        status: 'PENDING_UPLOAD',
        inputKey: `raw/${userId}/${id}.mp4`,
        correlationId: randomUUID(),
        createdAt,
        updatedAt: createdAt,
      },
    });
    return id;
  }

  it('RF-15: PENDING_UPLOAD older than 24h becomes EXPIRED; younger stays', async () => {
    const staleId = await seedPending(new Date(now.getTime() - 25 * 60 * 60 * 1000));
    const freshId = await seedPending(new Date(now.getTime() - 23 * 60 * 60 * 1000));

    const beforeVer = Number((await redis.get(`videos:ver:${userId}`)) ?? '0');
    const expire = app.get(ExpirePendingUploadsJob);
    await expect(expire.run(now)).resolves.toBeGreaterThanOrEqual(1);

    const stale = await prisma.video.findUniqueOrThrow({ where: { id: staleId } });
    const fresh = await prisma.video.findUniqueOrThrow({ where: { id: freshId } });
    expect(stale.status).toBe('EXPIRED');
    expect(fresh.status).toBe('PENDING_UPLOAD');

    const afterVer = Number((await redis.get(`videos:ver:${userId}`)) ?? '0');
    expect(afterVer).toBeGreaterThan(beforeVer);
  });

  it('E-04: deletes outbox >7d published and inbox >14d; keeps recent', async () => {
    const oldOutboxId = randomUUID();
    const recentOutboxId = randomUUID();
    const oldInboxId = randomUUID();
    const recentInboxId = randomUUID();

    await prisma.outbox.createMany({
      data: [
        {
          id: oldOutboxId,
          aggregateId: randomUUID(),
          type: 'video.process',
          destination: 'queue',
          payload: {},
          publishedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
        },
        {
          id: recentOutboxId,
          aggregateId: randomUUID(),
          type: 'video.process',
          destination: 'queue',
          payload: {},
          publishedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        },
      ],
    });
    await prisma.inbox.createMany({
      data: [
        {
          messageId: oldInboxId,
          type: 'video.processed',
          processedAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
        },
        {
          messageId: recentInboxId,
          type: 'video.processed',
          processedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        },
      ],
    });

    const house = app.get(HousekeepingJob);
    const result = await house.run(now);
    expect(result.outboxDeleted).toBeGreaterThanOrEqual(1);
    expect(result.inboxDeleted).toBeGreaterThanOrEqual(1);

    expect(await prisma.outbox.findUnique({ where: { id: oldOutboxId } })).toBeNull();
    expect(await prisma.outbox.findUnique({ where: { id: recentOutboxId } })).not.toBeNull();
    expect(await prisma.inbox.findUnique({ where: { messageId: oldInboxId } })).toBeNull();
    expect(await prisma.inbox.findUnique({ where: { messageId: recentInboxId } })).not.toBeNull();
  });
});
