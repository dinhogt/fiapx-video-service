/**
 * Proves S3 enforces content-length-range (D25 / T01).
 * Production policy uses 1..524_288_000; uploading 501 MB is impractical in CI,
 * so we (1) assert the production Policy encodes that ceiling and (2) upload
 * bodySize = max+1 against the same Conditions shape on LocalStack.
 */
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'node:crypto';
import { MAX_VIDEO_SIZE_BYTES } from '../../src/domain/video-file';
import { S3PresignedPostAdapter } from '../../src/infrastructure/storage/s3-presigned-post.adapter';
import type { VideoEnv } from '../../src/infrastructure/config/env';

const endpoint = process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:4566';
const bucket = process.env.S3_BUCKET ?? 'fiapx-local-videos';

const env: VideoEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  PORT: 3002,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://video_svc:change-me@localhost:5432/fiapx?schema=video',
  REDIS_URL: 'redis://localhost:6379',
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT: endpoint,
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  OTEL_SERVICE_NAME: 'video-service',
  JWT_ISSUER: 'http://issuer.test',
  JWT_AUDIENCE: 'fiapx-api',
  JWKS_URL: 'http://issuer.test/jwks.json',
  TRUST_GATEWAY_IP: false,
  S3_BUCKET: bucket,
  S3_PUBLIC_ENDPOINT: endpoint,
  VIDEO_PROCESS_QUEUE_URL: `${endpoint}/000000000000/fiapx-local-video-process`,
  VIDEO_STATUS_QUEUE_URL: `${endpoint}/000000000000/fiapx-local-video-status-updates`,
};

async function ensureBucket(client: S3Client): Promise<void> {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch {
    // already exists
  }
}

describe('S3 content-length-range (501 MB / D25)', () => {
  const client = new S3Client({
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

  beforeAll(async () => {
    await ensureBucket(client);
  }, 30_000);

  it('production adapter Policy encodes content-length-range 1..524288000', async () => {
    const adapter = new S3PresignedPostAdapter(env);
    const upload = await adapter.createPost({
      bucket,
      key: `raw/test/${randomUUID()}.mp4`,
      contentType: 'video/mp4',
      maxSizeBytes: MAX_VIDEO_SIZE_BYTES,
      expiresInSeconds: 900,
    });

    const policy = JSON.parse(Buffer.from(upload.fields.Policy, 'base64').toString('utf8')) as {
      conditions: unknown[];
    };
    const range = policy.conditions.find(
      (c) => Array.isArray(c) && c[0] === 'content-length-range',
    ) as [string, number, number] | undefined;
    expect(range).toEqual(['content-length-range', 1, MAX_VIDEO_SIZE_BYTES]);
    expect(MAX_VIDEO_SIZE_BYTES + 1).toBe(524_288_001); // 501 MB ceiling + 1 byte
  });

  it('LocalStack rejects body larger than content-length-range (same mechanism as 501 MB)', async () => {
    const maxAllowed = 100;
    const key = `raw/test/oversize-${Date.now()}.mp4`;
    const { url, fields } = await createPresignedPost(client, {
      Bucket: bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, maxAllowed],
        ['eq', '$Content-Type', 'video/mp4'],
      ],
      Fields: {
        key,
        'Content-Type': 'video/mp4',
      },
      Expires: 900,
    });

    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      form.append(name, value);
    }
    // 101 bytes → above content-length-range (analogous to 501 MB vs 500 MB)
    form.append('file', new Blob([Buffer.alloc(maxAllowed + 1)]), 'oversize.mp4');

    const response = await fetch(url, { method: 'POST', body: form });
    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const text = await response.text();
    expect(text.toLowerCase()).toMatch(/entitytoo|content-length|size|too large|max|exceed/i);
  });
});
