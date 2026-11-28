import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3ObjectStorageAdapter } from './s3-object-storage.adapter';
import type { VideoEnv } from '../config/env';

const send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  HeadObjectCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

const env: VideoEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  PORT: 3002,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://video_svc:change-me@localhost:5432/fiapx?schema=video',
  REDIS_URL: 'redis://localhost:6379',
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT: 'http://localhost:4566',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  OTEL_SERVICE_NAME: 'video-service',
  JWT_ISSUER: 'http://issuer.test',
  JWT_AUDIENCE: 'fiapx-api',
  JWKS_URL: 'http://issuer.test/jwks.json',
  TRUST_GATEWAY_IP: false,
  S3_BUCKET: 'fiapx-local-videos',
  S3_PUBLIC_ENDPOINT: 'http://localhost:4566',
  VIDEO_PROCESS_QUEUE_URL: 'http://localhost:4566/000000000000/q',
  VIDEO_STATUS_QUEUE_URL: 'http://localhost:4566/000000000000/s',
};

describe('S3ObjectStorageAdapter', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('returns true when HeadObject succeeds', async () => {
    send.mockResolvedValue({});
    const adapter = new S3ObjectStorageAdapter(env);

    await expect(adapter.exists('bucket', 'raw/u/v.mp4')).resolves.toBe(true);
    expect(S3Client).toHaveBeenCalled();
    expect(HeadObjectCommand).toHaveBeenCalledWith({ Bucket: 'bucket', Key: 'raw/u/v.mp4' });
  });

  it('returns false on 404 / NotFound', async () => {
    send.mockRejectedValue(
      Object.assign(new Error('missing'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    const adapter = new S3ObjectStorageAdapter(env);

    await expect(adapter.exists('bucket', 'missing')).resolves.toBe(false);
  });

  it('returns false on NoSuchKey without status', async () => {
    send.mockRejectedValue(Object.assign(new Error('gone'), { name: 'NoSuchKey' }));
    const adapter = new S3ObjectStorageAdapter(env);
    await expect(adapter.exists('bucket', 'gone')).resolves.toBe(false);
  });

  it('rethrows unexpected S3 errors', async () => {
    send.mockRejectedValue(Object.assign(new Error('boom'), { name: 'Timeout' }));
    const adapter = new S3ObjectStorageAdapter(env);
    await expect(adapter.exists('bucket', 'x')).rejects.toThrow('boom');
  });

  it('falls back to S3_PUBLIC_ENDPOINT and optional credentials', async () => {
    const localEnv = {
      ...env,
      AWS_ENDPOINT: undefined,
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
    };
    send.mockResolvedValue({});
    const adapter = new S3ObjectStorageAdapter(localEnv);
    await expect(adapter.exists('b', 'k')).resolves.toBe(true);
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: env.S3_PUBLIC_ENDPOINT,
        credentials: undefined,
      }),
    );
  });
});
