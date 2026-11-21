import { HealthService } from './health.service';
import type { VideoEnv } from '../config/env';

const env: VideoEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  PORT: 3002,
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://video_svc:change-me@127.0.0.1:1/fiapx?schema=video',
  REDIS_URL: 'redis://127.0.0.1:1',
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT: 'http://127.0.0.1:1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  OTEL_SERVICE_NAME: 'video-service',
  JWT_ISSUER: 'http://localhost:3001',
  JWT_AUDIENCE: 'fiapx-api',
  JWKS_URL: 'http://localhost:3001/.well-known/jwks.json',
  TRUST_GATEWAY_IP: false,
  S3_BUCKET: 'fiapx-local-videos',
  S3_PUBLIC_ENDPOINT: 'http://localhost:4566',
  VIDEO_PROCESS_QUEUE_URL: 'http://127.0.0.1:1/000000000000/fiapx-local-video-process',
  VIDEO_STATUS_QUEUE_URL: 'http://127.0.0.1:1/000000000000/fiapx-local-video-status-updates',
};

describe('HealthService', () => {
  it('reports live status without dependencies', () => {
    expect(new HealthService(env).live()).toEqual({ status: 'ok' });
  });

  it('marks ready as false when dependencies are unreachable', async () => {
    const result = await new HealthService(env).ready();
    expect(result.ready).toBe(false);
    expect(result.checks.map((check) => check.name).sort()).toEqual([
      'postgres',
      'redis',
      'sqs-process',
      'sqs-status',
    ]);
  }, 10000);
});
