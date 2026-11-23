import { buildEnvelope } from './build-envelope';
import { MessageSource, MessageType } from './envelope';
import { FailureCode } from './failure-code';
import { parseMessage, safeParseMessage } from './messages';

const ids = {
  messageId: '11111111-1111-4111-8111-111111111111',
  correlationId: '22222222-2222-4222-8222-222222222222',
  videoId: '33333333-3333-4333-8333-333333333333',
  userId: '44444444-4444-4444-8444-444444444444',
};

const traceparent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

describe('message contracts', () => {
  it('parses a valid video.process message', () => {
    const message = buildEnvelope({
      type: MessageType.VIDEO_PROCESS,
      source: MessageSource.VIDEO_SERVICE,
      correlationId: ids.correlationId,
      traceparent,
      messageId: ids.messageId,
      occurredAt: '2026-11-20T12:00:00.000Z',
      payload: {
        videoId: ids.videoId,
        userId: ids.userId,
        inputKey: `raw/${ids.userId}/${ids.videoId}.mp4`,
        outputKey: `output/${ids.userId}/${ids.videoId}/frames.zip`,
        fps: 1,
        fileName: 'demo.mp4',
      },
    });

    expect(parseMessage(message).type).toBe('video.process');
  });

  it('parses the other four message types', () => {
    const processing = buildEnvelope({
      type: MessageType.VIDEO_PROCESSING,
      source: MessageSource.VIDEO_WORKER,
      correlationId: ids.correlationId,
      traceparent,
      payload: {
        videoId: ids.videoId,
        userId: ids.userId,
        attempt: 1,
        startedAt: '2026-11-20T12:00:01.000Z',
      },
    });
    const processed = buildEnvelope({
      type: MessageType.VIDEO_PROCESSED,
      source: MessageSource.VIDEO_WORKER,
      correlationId: ids.correlationId,
      traceparent,
      payload: {
        videoId: ids.videoId,
        userId: ids.userId,
        outputKey: `output/${ids.userId}/${ids.videoId}/frames.zip`,
        frameCount: 5,
        zipSizeBytes: 1024,
        durationMs: 1200,
        completedAt: '2026-11-20T12:00:02.000Z',
      },
    });
    const failed = buildEnvelope({
      type: MessageType.VIDEO_FAILED,
      source: MessageSource.VIDEO_WORKER,
      correlationId: ids.correlationId,
      traceparent,
      payload: {
        videoId: ids.videoId,
        userId: ids.userId,
        fileName: 'demo.mp4',
        failureCode: FailureCode.INVALID_VIDEO,
        failureMessage: 'Arquivo de vídeo inválido.',
        attempts: 1,
        failedAt: '2026-11-20T12:00:03.000Z',
      },
    });
    const registered = buildEnvelope({
      type: MessageType.USER_REGISTERED,
      source: MessageSource.AUTH_SERVICE,
      correlationId: ids.correlationId,
      traceparent,
      payload: {
        userId: ids.userId,
        email: 'user@example.com',
        name: 'Ada Lovelace',
        registeredAt: '2026-11-20T12:00:00.000Z',
      },
    });

    expect(parseMessage(processing).type).toBe('video.processing');
    expect(parseMessage(processed).type).toBe('video.processed');
    expect(parseMessage(failed).type).toBe('video.failed');
    expect(parseMessage(registered).type).toBe('user.registered');
  });

  it('rejects an invalid payload', () => {
    const result = safeParseMessage({
      messageId: 'not-a-uuid',
      type: 'video.process',
      version: 1,
      occurredAt: 'yesterday',
      source: 'video-service',
      correlationId: ids.correlationId,
      causationId: null,
      traceparent: 'bad',
      payload: {},
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown failure code', () => {
    const result = safeParseMessage({
      messageId: ids.messageId,
      type: 'video.failed',
      version: 1,
      occurredAt: '2026-11-20T12:00:03.000Z',
      source: 'video-worker',
      correlationId: ids.correlationId,
      causationId: null,
      traceparent,
      payload: {
        videoId: ids.videoId,
        userId: ids.userId,
        fileName: 'demo.mp4',
        failureCode: 'UNKNOWN',
        failureMessage: 'falha',
        attempts: 1,
        failedAt: '2026-11-20T12:00:03.000Z',
      },
    });

    expect(result.success).toBe(false);
  });
});
