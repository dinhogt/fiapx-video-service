import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { SqsMessagePublisher } from './sqs-message-publisher';
import type { VideoEnv } from '../config/env';

const send = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send })),
  SendMessageCommand: jest.fn().mockImplementation((input: unknown) => input),
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

describe('SqsMessagePublisher', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it('sends JSON body to the queue URL with type attribute', async () => {
    const publisher = new SqsMessagePublisher(env);
    await publisher.publish({
      destination: env.VIDEO_PROCESS_QUEUE_URL,
      type: 'video.process',
      body: { type: 'video.process', payload: { videoId: 'v1' } },
    });

    expect(SQSClient).toHaveBeenCalled();
    expect(SendMessageCommand).toHaveBeenCalledWith({
      QueueUrl: env.VIDEO_PROCESS_QUEUE_URL,
      MessageBody: JSON.stringify({ type: 'video.process', payload: { videoId: 'v1' } }),
      MessageAttributes: {
        type: { DataType: 'String', StringValue: 'video.process' },
      },
    });
  });
});
