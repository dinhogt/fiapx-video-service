/**
 * AC-71: with the outbox relay stopped (test env disables the timer), pending
 * rows stay unpublished; after "restart" (explicit drain) they reach SQS.
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/infrastructure/config/env';
import { OutboxRelayService } from '../../src/infrastructure/messaging/outbox-relay.service';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://video_svc:change-me@localhost:5432/fiapx?schema=video&connection_limit=5&sslmode=disable';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const AWS_ENDPOINT = process.env.AWS_ENDPOINT ?? 'http://localhost:4566';
const BUCKET = 'fiapx-local-videos';
const PROCESS_QUEUE_URL = `${AWS_ENDPOINT}/000000000000/fiapx-local-video-process`;

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
    AWS_ENDPOINT,
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    OTEL_SERVICE_NAME: 'video-service',
    JWT_ISSUER: 'http://issuer.test',
    JWT_AUDIENCE: 'fiapx-api',
    JWKS_URL: jwksUrl,
    TRUST_GATEWAY_IP: 'false',
    S3_BUCKET: BUCKET,
    S3_PUBLIC_ENDPOINT: AWS_ENDPOINT,
    VIDEO_PROCESS_QUEUE_URL: PROCESS_QUEUE_URL,
    VIDEO_STATUS_QUEUE_URL: `${AWS_ENDPOINT}/000000000000/fiapx-local-video-status-updates`,
  });

  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    logger: false,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return app;
}

async function drainQueue(sqs: SQSClient): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    const received = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: PROCESS_QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
      }),
    );
    const messages = received.Messages ?? [];
    if (messages.length === 0) {
      return;
    }
    for (const message of messages) {
      if (message.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: PROCESS_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      }
    }
  }
}

async function waitForVideoProcess(
  sqs: SQSClient,
  videoId: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const received = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: PROCESS_QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    for (const message of received.Messages ?? []) {
      const body = JSON.parse(message.Body ?? '{}') as {
        type?: string;
        payload?: { videoId?: string };
      };
      if (message.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: PROCESS_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      }
      if (body.type === 'video.process' && body.payload?.videoId === videoId) {
        return body;
      }
    }
  }
  throw new Error(`Timed out waiting for video.process for ${videoId}`);
}

describe('Outbox relay → SQS video-process (F3.5 / AC-71)', () => {
  let app: NestExpressApplication;
  let jwksServer: Server;
  let privateKey: KeyLike;
  let redis: Redis;
  let prisma: PrismaClient;
  let sqs: SQSClient;
  let s3: S3Client;
  const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = 'f35-kid';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const started = await startJwksServer(jwk);
    jwksServer = started.server;
    app = await bootApp(started.url);
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    sqs = new SQSClient({
      region: 'us-east-1',
      endpoint: AWS_ENDPOINT,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    s3 = new S3Client({
      region: 'us-east-1',
      endpoint: AWS_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch {
      // exists
    }
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
      .setProtectedHeader({ alg: 'RS256', kid: 'f35-kid' })
      .setSubject(userId)
      .setIssuer('http://issuer.test')
      .setAudience('fiapx-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  it('AC-71: pending outbox stays until relay drain (restart) publishes to SQS', async () => {
    await drainQueue(sqs);

    const token = await signAccess();
    const created = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .set('x-correlation-id', randomUUID())
      .send({
        fileName: 'relay.mp4',
        sizeBytes: 256,
        contentType: 'video/mp4',
      });
    expect(created.status).toBe(201);
    const videoId = created.body.videoId as string;
    const inputKey = created.body.upload.fields.key as string;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: inputKey,
        Body: Buffer.from('mp4'),
        ContentType: 'video/mp4',
      }),
    );

    const confirmed = await request(app.getHttpServer())
      .post(`/videos/${videoId}/confirm`)
      .set('Authorization', `Bearer ${token}`);
    expect(confirmed.status).toBe(202);

    // Relay is stopped in test (no timer / kick no-op) → pending remains.
    const pending = await prisma.outbox.findFirstOrThrow({ where: { aggregateId: videoId } });
    expect(pending.publishedAt).toBeNull();
    expect(pending.type).toBe('video.process');

    const premature = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: PROCESS_QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
      }),
    );
    expect(premature.Messages ?? []).toHaveLength(0);

    // "Restart" the relay by draining explicitly.
    await app.get(OutboxRelayService).drain();

    const envelope = await waitForVideoProcess(sqs, videoId);
    expect(envelope).toMatchObject({
      type: 'video.process',
      source: 'video-service',
      payload: {
        videoId,
        userId,
        inputKey,
        fileName: 'relay.mp4',
      },
    });

    const published = await prisma.outbox.findFirstOrThrow({ where: { aggregateId: videoId } });
    expect(published.publishedAt).not.toBeNull();
    expect(published.attempts).toBe(0);
  }, 60_000);
});
