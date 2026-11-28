/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
const S3_ENDPOINT = process.env.AWS_ENDPOINT ?? 'http://localhost:4566';
const BUCKET = 'fiapx-local-videos';

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
    AWS_ENDPOINT: S3_ENDPOINT,
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    OTEL_SERVICE_NAME: 'video-service',
    JWT_ISSUER: 'http://issuer.test',
    JWT_AUDIENCE: 'fiapx-api',
    JWKS_URL: jwksUrl,
    TRUST_GATEWAY_IP: 'false',
    S3_BUCKET: BUCKET,
    S3_PUBLIC_ENDPOINT: S3_ENDPOINT,
    VIDEO_PROCESS_QUEUE_URL: `${S3_ENDPOINT}/000000000000/fiapx-local-video-process`,
    VIDEO_STATUS_QUEUE_URL: `${S3_ENDPOINT}/000000000000/fiapx-local-video-status-updates`,
  });

  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    logger: false,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return app;
}

describe('POST /videos/:id/confirm (F3.4 / AC-21 / AC-22 / AC-23)', () => {
  let app: NestExpressApplication;
  let jwksServer: Server;
  let privateKey: KeyLike;
  let redis: Redis;
  let prisma: PrismaClient;
  let s3: S3Client;
  const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = 'f34-kid';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const started = await startJwksServer(jwk);
    jwksServer = started.server;
    app = await bootApp(started.url);
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    s3 = new S3Client({
      region: 'us-east-1',
      endpoint: S3_ENDPOINT,
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
      .setProtectedHeader({ alg: 'RS256', kid: 'f34-kid' })
      .setSubject(userId)
      .setIssuer('http://issuer.test')
      .setAudience('fiapx-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  async function createPending(): Promise<{ videoId: string; inputKey: string; token: string }> {
    const token = await signAccess();
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .set('x-correlation-id', randomUUID())
      .send({
        fileName: 'clip.mp4',
        sizeBytes: 512,
        contentType: 'video/mp4',
      });
    expect(res.status).toBe(201);
    return {
      videoId: res.body.videoId,
      inputKey: res.body.upload.fields.key,
      token,
    };
  }

  it('AC-22: confirm without S3 object → 409 and stays PENDING_UPLOAD', async () => {
    const { videoId, token } = await createPending();

    const res = await request(app.getHttpServer())
      .post(`/videos/${videoId}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    const row = await prisma.video.findUnique({ where: { id: videoId } });
    expect(row?.status).toBe('PENDING_UPLOAD');
    expect(await prisma.outbox.count({ where: { aggregateId: videoId } })).toBe(0);
  });

  it('AC-21: confirm with object → 202 QUEUED + outbox video.process', async () => {
    const { videoId, inputKey, token } = await createPending();
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: inputKey,
        Body: Buffer.from('fake-mp4'),
        ContentType: 'video/mp4',
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/videos/${videoId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .set('traceparent', '00-cccccccccccccccccccccccccccccccc-dddddddddddddddd-01');

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ videoId, status: 'QUEUED' });

    const row = await prisma.video.findUnique({ where: { id: videoId } });
    expect(row?.status).toBe('QUEUED');
    expect(row?.queuedAt).toBeTruthy();

    const outbox = await prisma.outbox.findMany({ where: { aggregateId: videoId } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.type).toBe('video.process');
    expect(outbox[0]?.publishedAt).toBeNull();
    const payload = outbox[0]?.payload as {
      type: string;
      traceparent: string;
      payload: { videoId: string };
    };
    expect(payload.type).toBe('video.process');
    expect(payload.payload.videoId).toBe(videoId);
    expect(payload.traceparent).toBe('00-cccccccccccccccccccccccccccccccc-dddddddddddddddd-01');
  });

  it('AC-23: second confirm is idempotent — still one outbox row', async () => {
    const { videoId, inputKey, token } = await createPending();
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: inputKey,
        Body: Buffer.from('fake-mp4-2'),
        ContentType: 'video/mp4',
      }),
    );

    const first = await request(app.getHttpServer())
      .post(`/videos/${videoId}/confirm`)
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(202);

    const second = await request(app.getHttpServer())
      .post(`/videos/${videoId}/confirm`)
      .set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(202);
    expect(second.body.status).toBe('QUEUED');

    expect(await prisma.outbox.count({ where: { aggregateId: videoId } })).toBe(1);
  });
});
