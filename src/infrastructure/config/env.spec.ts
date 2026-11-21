import { loadEnv } from './env';

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  PORT: '3002',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://video_svc:change-me@localhost:5432/fiapx?schema=video',
  REDIS_URL: 'redis://localhost:6379',
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT: 'http://localhost:4566',
  OTEL_SERVICE_NAME: 'video-service',
  JWT_ISSUER: 'http://localhost:3001',
  JWT_AUDIENCE: 'fiapx-api',
  JWKS_URL: 'http://localhost:3001/.well-known/jwks.json',
  TRUST_GATEWAY_IP: 'false',
  S3_BUCKET: 'fiapx-local-videos',
  S3_PUBLIC_ENDPOINT: 'http://localhost:4566',
  VIDEO_PROCESS_QUEUE_URL: 'http://localhost:4566/000000000000/fiapx-local-video-process',
  VIDEO_STATUS_QUEUE_URL: 'http://localhost:4566/000000000000/fiapx-local-video-status-updates',
};

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(3002);
    expect(env.S3_BUCKET).toBe('fiapx-local-videos');
  });

  it('fails when required values are missing', () => {
    expect(() => loadEnv({})).toThrow(/Invalid configuration/);
  });

  it('accepts an empty optional OTEL endpoint', () => {
    const env = loadEnv({ ...validEnv, OTEL_EXPORTER_OTLP_ENDPOINT: '' });
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('');
  });
});
