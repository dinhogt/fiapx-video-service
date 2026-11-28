/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { VideoStatusConsumerService } from './video-status-consumer.service';
import type { ApplyStatusEventUseCase } from '../../application/apply-status-event.use-case';
import type { VideoEnv } from '../config/env';

const send = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send })),
  ReceiveMessageCommand: jest.fn().mockImplementation((input: unknown) => ({
    __type: 'ReceiveMessageCommand',
    input,
  })),
  DeleteMessageCommand: jest.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteMessageCommand',
    input,
  })),
}));

function makeEnv(overrides: Partial<VideoEnv> = {}): VideoEnv {
  return {
    APP_ENV: 'test',
    NODE_ENV: 'test',
    AWS_REGION: 'us-east-1',
    AWS_ENDPOINT: 'http://localhost:4566',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    VIDEO_STATUS_QUEUE_URL: 'http://localhost:4566/000000000000/status',
    ...overrides,
  } as VideoEnv;
}

function deleteCalls(): unknown[] {
  return send.mock.calls
    .map((call: unknown[]) => call[0] as { __type?: string })
    .filter((cmd) => cmd.__type === 'DeleteMessageCommand');
}

describe('VideoStatusConsumerService', () => {
  beforeEach(() => {
    send.mockReset();
    jest.mocked(ReceiveMessageCommand).mockClear();
  });

  it('onModuleInit is a no-op in test env', () => {
    const apply = { execute: jest.fn() } as unknown as ApplyStatusEventUseCase;
    const consumer = new VideoStatusConsumerService(apply, makeEnv());
    consumer.onModuleInit();
    consumer.onModuleDestroy();
    expect(send).not.toHaveBeenCalled();
  });

  it('onModuleInit starts polling outside test env', () => {
    jest.useFakeTimers();
    const apply = { execute: jest.fn() } as unknown as ApplyStatusEventUseCase;
    send.mockResolvedValue({ Messages: [] });
    const consumer = new VideoStatusConsumerService(
      apply,
      makeEnv({ APP_ENV: 'local', NODE_ENV: 'development' }),
    );
    consumer.onModuleInit();
    expect(send).toHaveBeenCalled();
    consumer.onModuleDestroy();
    jest.useRealTimers();
  });

  it('builds client without static credentials when keys are absent', () => {
    const apply = { execute: jest.fn() } as unknown as ApplyStatusEventUseCase;
    expect(
      () =>
        new VideoStatusConsumerService(
          apply,
          makeEnv({
            AWS_ACCESS_KEY_ID: undefined,
            AWS_SECRET_ACCESS_KEY: undefined,
          }),
        ),
    ).not.toThrow();
  });

  it('drain processes raw JSON and deletes the message', async () => {
    const apply = {
      execute: jest.fn(async () => 'applied'),
    } as unknown as ApplyStatusEventUseCase;
    send.mockResolvedValueOnce({
      Messages: [{ Body: JSON.stringify({ type: 'video.processed' }), ReceiptHandle: 'rh-1' }],
    });

    await new VideoStatusConsumerService(apply, makeEnv()).drain();

    expect(ReceiveMessageCommand).toHaveBeenCalled();
    expect(apply.execute).toHaveBeenCalledWith({ type: 'video.processed' });
    expect(deleteCalls()).toHaveLength(1);
  });

  it('unwraps SNS envelope Message field', async () => {
    const apply = {
      execute: jest.fn(async () => 'ignored'),
    } as unknown as ApplyStatusEventUseCase;
    const inner = { type: 'video.processing', messageId: 'm1' };
    send.mockResolvedValueOnce({
      Messages: [
        {
          Body: JSON.stringify({ Message: JSON.stringify(inner) }),
          ReceiptHandle: 'rh-2',
        },
      ],
    });

    await new VideoStatusConsumerService(apply, makeEnv()).drain();
    expect(apply.execute).toHaveBeenCalledWith(inner);
    expect(deleteCalls()).toHaveLength(1);
  });

  it('deletes when SNS Message field is not JSON', async () => {
    const apply = { execute: jest.fn() } as unknown as ApplyStatusEventUseCase;
    send.mockResolvedValueOnce({
      Messages: [
        {
          Body: JSON.stringify({ Message: 'not-json' }),
          ReceiptHandle: 'rh-sns-bad',
        },
      ],
    });

    await new VideoStatusConsumerService(apply, makeEnv()).drain();
    expect(apply.execute).not.toHaveBeenCalled();
    expect(deleteCalls()).toHaveLength(1);
  });

  it('deletes invalid JSON without applying', async () => {
    const apply = { execute: jest.fn() } as unknown as ApplyStatusEventUseCase;
    send.mockResolvedValueOnce({
      Messages: [{ Body: 'not-json', ReceiptHandle: 'rh-3' }],
    });

    await new VideoStatusConsumerService(apply, makeEnv()).drain();
    expect(apply.execute).not.toHaveBeenCalled();
    expect(deleteCalls()).toHaveLength(1);
  });

  it('deletes invalid_message results from the use case', async () => {
    const apply = {
      execute: jest.fn(async () => 'invalid_message'),
    } as unknown as ApplyStatusEventUseCase;
    send.mockResolvedValueOnce({
      Messages: [{ Body: '{}', ReceiptHandle: 'rh-invalid' }],
    });

    await new VideoStatusConsumerService(apply, makeEnv()).drain();
    expect(deleteCalls()).toHaveLength(1);
  });

  it('does not delete when apply throws (retry)', async () => {
    const apply = {
      execute: jest.fn(async () => {
        throw new Error('db down');
      }),
    } as unknown as ApplyStatusEventUseCase;
    send.mockResolvedValueOnce({
      Messages: [{ Body: '{}', ReceiptHandle: 'rh-4' }],
    });

    await new VideoStatusConsumerService(apply, makeEnv()).drain();
    expect(deleteCalls()).toHaveLength(0);
  });

  it('skips messages without body or receipt handle', async () => {
    const apply = { execute: jest.fn() } as unknown as ApplyStatusEventUseCase;
    send.mockResolvedValueOnce({
      Messages: [{ Body: undefined, ReceiptHandle: 'rh' }, { Body: '{}', ReceiptHandle: undefined }],
    });

    await new VideoStatusConsumerService(apply, makeEnv()).drain();
    expect(apply.execute).not.toHaveBeenCalled();
    expect(deleteCalls()).toHaveLength(0);
  });

  it('logs poll failures without throwing', async () => {
    const apply = { execute: jest.fn() } as unknown as ApplyStatusEventUseCase;
    send.mockRejectedValueOnce(new Error('sqs down'));
    await expect(new VideoStatusConsumerService(apply, makeEnv()).drain()).resolves.toBeUndefined();
  });

  it('processBody delegates to use case', async () => {
    const apply = {
      execute: jest.fn(async () => 'duplicate'),
    } as unknown as ApplyStatusEventUseCase;
    const consumer = new VideoStatusConsumerService(apply, makeEnv());
    await expect(consumer.processBody({ hello: 1 })).resolves.toBe('duplicate');
  });

  it('skips concurrent drain and stopped drain', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    send.mockImplementation(async () => {
      await gate;
      return { Messages: [] };
    });
    const consumer = new VideoStatusConsumerService(
      { execute: jest.fn() } as unknown as ApplyStatusEventUseCase,
      makeEnv(),
    );
    const first = consumer.drain();
    const second = consumer.drain();
    consumer.onModuleDestroy();
    const stopped = consumer.drain();
    release();
    await Promise.all([first, second, stopped]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
