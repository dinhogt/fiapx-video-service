import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, type Server } from 'node:http';
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

async function startJwksServer(jwk: object): Promise<{
  server: Server;
  url: string;
}> {
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

describe('GET /videos auth (AC-13, F2.9)', () => {
  let app: NestExpressApplication;
  let jwksServer: Server;
  let privateKey: KeyLike;
  let redis: Redis;

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = 'ac13-kid';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const started = await startJwksServer(jwk);
    jwksServer = started.server;
    app = await bootApp(started.url);
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await redis?.quit().catch(() => undefined);
    await new Promise<void>((resolve, reject) => {
      jwksServer?.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function signAccess(overrides: {
    exp?: Date | string | number;
    sid?: string;
    sub?: string;
  } = {}): Promise<string> {
    return new SignJWT({ sid: overrides.sid ?? '33333333-3333-4333-8333-333333333333' })
      .setProtectedHeader({ alg: 'RS256', kid: 'ac13-kid' })
      .setIssuer('http://issuer.test')
      .setAudience('fiapx-api')
      .setSubject(overrides.sub ?? '11111111-1111-4111-8111-111111111111')
      .setExpirationTime(overrides.exp ?? '15m')
      .sign(privateKey);
  }

  it('AC-13: missing, expired or invalid signature tokens receive 401 on /videos', async () => {
    await request(app.getHttpServer()).get('/videos').expect(401);

    const forged = await signAccess();
    const tampered = `${forged.slice(0, -4)}xxxx`;
    await request(app.getHttpServer())
      .get('/videos')
      .set('Authorization', `Bearer ${tampered}`)
      .expect(401);

    // Beyond clockTolerance (30s): expired 2 minutes ago.
    const expired = await signAccess({ exp: new Date(Date.now() - 120_000) });
    await request(app.getHttpServer())
      .get('/videos')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  }, 60_000);

  it('accepts a valid token and rejects a revoked sid', async () => {
    const sid = '44444444-4444-4444-8444-444444444444';
    const token = await signAccess({ sid });
    const ok = await request(app.getHttpServer())
      .get('/videos')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = ok.body as { items: unknown[]; nextCursor: string | null };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.nextCursor).toBeNull();

    await redis.set(`revoked:sid:${sid}`, '1', 'EX', 60);
    await request(app.getHttpServer())
      .get('/videos')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await redis.del(`revoked:sid:${sid}`);
  }, 60_000);
});
