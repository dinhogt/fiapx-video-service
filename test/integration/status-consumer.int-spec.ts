import { buildEnvelope, MessageSource } from '@dinhogt/fiapx-contracts';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma, PrismaClient } from '@prisma/client';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';
import Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/infrastructure/config/env';
import { VideoStatusConsumerService } from '../../src/infrastructure/messaging/video-status-consumer.service';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://video_svc:change-me@localhost:5432/fiapx?schema=video&connection_limit=5&sslmode=disable';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const traceparent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

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

describe('Status consumer (F3.8 / out-of-order)', () => {
  let app: NestExpressApplication;
  let jwksServer: Server;
  let redis: Redis;
  let prisma: PrismaClient;
  const userId = '12121212-1212-4121-8121-121212121212';

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = 'f38-kid';
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

  async function seedQueued(): Promise<string> {
    const id = randomUUID();
    await prisma.video.create({
      data: {
        id,
        userId,
        fileName: 'demo.mp4',
        contentType: 'video/mp4',
        sizeBytes: 10n,
        fps: new Prisma.Decimal(1),
        status: 'QUEUED',
        inputKey: `raw/${userId}/${id}.mp4`,
        correlationId: randomUUID(),
        queuedAt: new Date(),
      },
    });
    return id;
  }

  it('applies processed then ignores late processing (inbox only)', async () => {
    const videoId = await seedQueued();
    const consumer = app.get(VideoStatusConsumerService);

    const processed = buildEnvelope({
      type: 'video.processed',
      source: MessageSource.VIDEO_WORKER,
      correlationId: randomUUID(),
      traceparent,
      payload: {
        videoId,
        userId,
        outputKey: `output/${userId}/${videoId}/frames.zip`,
        frameCount: 4,
        zipSizeBytes: 200,
        durationMs: 1500,
        completedAt: new Date().toISOString(),
      },
    });
    await expect(consumer.processBody(processed)).resolves.toBe('applied');

    const afterProcessed = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(afterProcessed.status).toBe('COMPLETED');
    expect(afterProcessed.frameCount).toBe(4);

    const lateProcessing = buildEnvelope({
      type: 'video.processing',
      source: MessageSource.VIDEO_WORKER,
      correlationId: randomUUID(),
      traceparent,
      payload: {
        videoId,
        userId,
        attempt: 1,
        startedAt: new Date().toISOString(),
      },
    });
    await expect(consumer.processBody(lateProcessing)).resolves.toBe('ignored');

    const afterLate = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(afterLate.status).toBe('COMPLETED');

    const inbox = await prisma.inbox.findMany({
      where: { messageId: { in: [processed.messageId, lateProcessing.messageId] } },
    });
    expect(inbox).toHaveLength(2);

    const ver = await redis.get(`videos:ver:${userId}`);
    expect(Number(ver ?? '0')).toBeGreaterThanOrEqual(1);
  });
});
