import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { S3PresignedPostAdapter } from './s3-presigned-post.adapter';
import type { VideoEnv } from '../config/env';
import { MAX_VIDEO_SIZE_BYTES } from '../../domain/video-file';

jest.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
}));

const env: VideoEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  PORT: 3002,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://video_svc:change-me@localhost:5432/fiapx?schema=video',
  REDIS_URL: 'redis://localhost:6379',
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT: 'http://localstack:4566',
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

describe('S3PresignedPostAdapter', () => {
  it('signs with content-length-range 1–500 MB, Content-Type and server key', async () => {
    const mocked = createPresignedPost as jest.MockedFunction<typeof createPresignedPost>;
    mocked.mockResolvedValue({
      url: 'http://localhost:4566/fiapx-local-videos',
      fields: {
        key: 'raw/u/v.mp4',
        'Content-Type': 'video/mp4',
        Policy: 'encoded',
        'X-Amz-Signature': 'sig',
      },
    });

    const adapter = new S3PresignedPostAdapter(env);
    const result = await adapter.createPost({
      bucket: 'fiapx-local-videos',
      key: 'raw/u/v.mp4',
      contentType: 'video/mp4',
      maxSizeBytes: MAX_VIDEO_SIZE_BYTES,
      expiresInSeconds: 900,
    });

    expect(mocked).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        Bucket: 'fiapx-local-videos',
        Key: 'raw/u/v.mp4',
        Expires: 900,
        Conditions: [
          ['content-length-range', 1, MAX_VIDEO_SIZE_BYTES],
          ['eq', '$Content-Type', 'video/mp4'],
        ],
        Fields: {
          key: 'raw/u/v.mp4',
          'Content-Type': 'video/mp4',
        },
      }),
    );
    expect(result.method).toBe('POST');
    expect(result.url).toContain('localhost:4566');
    expect(result.fields.key).toBe('raw/u/v.mp4');
  });
});
