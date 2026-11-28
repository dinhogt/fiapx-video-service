import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3PresignedGetAdapter } from './s3-presigned-get.adapter';
import type { VideoEnv } from '../config/env';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  GetObjectCommand: jest.fn().mockImplementation((input: unknown) => input),
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

describe('S3PresignedGetAdapter', () => {
  it('signs GET with ResponseContentDisposition on S3_PUBLIC_ENDPOINT', async () => {
    const mocked = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>;
    mocked.mockResolvedValue('http://localhost:4566/fiapx-local-videos/output/x?sig=1');

    const adapter = new S3PresignedGetAdapter(env);
    const result = await adapter.createGet({
      bucket: 'fiapx-local-videos',
      key: 'output/u/v/frames.zip',
      expiresInSeconds: 300,
      responseContentDisposition: 'attachment; filename="demo_frames.zip"',
    });

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://localhost:4566', forcePathStyle: true }),
    );
    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'fiapx-local-videos',
      Key: 'output/u/v/frames.zip',
      ResponseContentDisposition: 'attachment; filename="demo_frames.zip"',
    });
    expect(result.url).toContain('localhost:4566');
  });
});
