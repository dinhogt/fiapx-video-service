/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { buildEnvelope, MessageSource } from '@dinhogt/fiapx-contracts';
import { randomUUID } from 'node:crypto';
import { ApplyStatusEventUseCase } from './apply-status-event.use-case';
import { Fps } from '../domain/fps';
import type { VideoListCache } from '../domain/ports/video-list-cache';
import type { VideoRepository } from '../domain/ports/video-repository';
import { Video } from '../domain/video';
import { VideoFile } from '../domain/video-file';

const userId = '11111111-1111-4111-8111-111111111111';
const videoId = '22222222-2222-4222-8222-222222222222';
const traceparent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

function queuedVideo(): Video {
  const file = VideoFile.create({
    fileName: 'demo.mp4',
    contentType: 'video/mp4',
    sizeBytes: 10,
  });
  if (!file.ok) {
    throw new Error('fixture');
  }
  const fps = Fps.create(1);
  if (!fps.ok) {
    throw new Error('fixture');
  }
  const video = Video.create({
    id: videoId,
    userId,
    file: file.value,
    fps: fps.value,
    inputKey: `raw/${userId}/${videoId}.mp4`,
  });
  video.queue();
  return video;
}

function completedVideo(): Video {
  const video = queuedVideo();
  video.complete({
    frameCount: 2,
    zipSizeBytes: 10n,
    outputKey: `output/${userId}/${videoId}/frames.zip`,
  });
  return video;
}

function makeCache(): VideoListCache {
  return {
    getVersion: jest.fn(async () => '0'),
    bumpVersion: jest.fn(async () => undefined),
    getList: jest.fn(async () => null),
    setList: jest.fn(async () => undefined),
  };
}

describe('ApplyStatusEventUseCase (F3.8 / B2)', () => {
  it('applies video.processing and bumps list version', async () => {
    const video = queuedVideo();
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(async () => video),
      findByIdForUser: jest.fn(),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
      recordInboxAndMaybeUpdate: jest.fn(async () => 'saved'),
    };
    const cache = makeCache();
    const useCase = new ApplyStatusEventUseCase(videos, cache);
    const envelope = buildEnvelope({
      type: 'video.processing',
      source: MessageSource.VIDEO_WORKER,
      correlationId: randomUUID(),
      traceparent,
      payload: {
        videoId,
        userId,
        attempt: 1,
        startedAt: new Date().toISOString(),
      },
    });

    await expect(useCase.execute(envelope)).resolves.toBe('applied');
    expect(videos.recordInboxAndMaybeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: envelope.messageId,
        type: 'video.processing',
        video: expect.objectContaining({ status: 'PROCESSING' }),
      }),
    );
    expect(cache.bumpVersion).toHaveBeenCalledWith(userId);
  });

  it('ignores out-of-order processing after COMPLETED but still records inbox', async () => {
    const video = completedVideo();
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(async () => video),
      findByIdForUser: jest.fn(),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
      recordInboxAndMaybeUpdate: jest.fn(async () => 'saved'),
    };
    const cache = makeCache();
    const useCase = new ApplyStatusEventUseCase(videos, cache);
    const envelope = buildEnvelope({
      type: 'video.processing',
      source: MessageSource.VIDEO_WORKER,
      correlationId: randomUUID(),
      traceparent,
      payload: {
        videoId,
        userId,
        attempt: 1,
        startedAt: new Date().toISOString(),
      },
    });

    await expect(useCase.execute(envelope)).resolves.toBe('ignored');
    expect(videos.recordInboxAndMaybeUpdate).toHaveBeenCalledWith({
      messageId: envelope.messageId,
      type: 'video.processing',
      video: undefined,
    });
    expect(cache.bumpVersion).not.toHaveBeenCalled();
    expect(video.status).toBe('COMPLETED');
  });

  it('applies video.processed from QUEUED (allowed out-of-order COMPLETED)', async () => {
    const video = queuedVideo();
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(async () => video),
      findByIdForUser: jest.fn(),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
      recordInboxAndMaybeUpdate: jest.fn(async () => 'saved'),
    };
    const useCase = new ApplyStatusEventUseCase(videos, makeCache());
    const envelope = buildEnvelope({
      type: 'video.processed',
      source: MessageSource.VIDEO_WORKER,
      correlationId: randomUUID(),
      traceparent,
      payload: {
        videoId,
        userId,
        outputKey: `output/${userId}/${videoId}/frames.zip`,
        frameCount: 5,
        zipSizeBytes: 100,
        durationMs: 1000,
        completedAt: new Date().toISOString(),
      },
    });

    await expect(useCase.execute(envelope)).resolves.toBe('applied');
    expect(video.status).toBe('COMPLETED');
  });

  it('rejects invalid payloads and absorbs missing videos into inbox', async () => {
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(async () => null),
      findByIdForUser: jest.fn(),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
      recordInboxAndMaybeUpdate: jest.fn(async () => 'saved'),
    };
    const useCase = new ApplyStatusEventUseCase(videos, makeCache());
    await expect(useCase.execute({ nope: true })).resolves.toBe('invalid_message');

    const envelope = buildEnvelope({
      type: 'video.processing',
      source: MessageSource.VIDEO_WORKER,
      correlationId: randomUUID(),
      traceparent,
      payload: {
        videoId,
        userId,
        attempt: 1,
        startedAt: new Date().toISOString(),
      },
    });
    await expect(useCase.execute(envelope)).resolves.toBe('video_not_found');
    expect(videos.recordInboxAndMaybeUpdate).toHaveBeenCalledWith({
      messageId: envelope.messageId,
      type: 'video.processing',
    });

    await expect(
      useCase.execute(
        buildEnvelope({
          type: 'video.process',
          source: MessageSource.VIDEO_SERVICE,
          correlationId: randomUUID(),
          traceparent,
          payload: {
            videoId,
            userId,
            inputKey: 'raw/a/b.mp4',
            outputKey: 'output/a/b/frames.zip',
            fps: 1,
            fileName: 'b.mp4',
          },
        }),
      ),
    ).resolves.toBe('invalid_message');
  });

  it('returns duplicate when inbox already has messageId', async () => {
    const video = queuedVideo();
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(async () => video),
      findByIdForUser: jest.fn(),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
      recordInboxAndMaybeUpdate: jest.fn(async () => 'duplicate'),
    };
    const useCase = new ApplyStatusEventUseCase(videos, makeCache());
    const envelope = buildEnvelope({
      type: 'video.failed',
      source: MessageSource.VIDEO_WORKER,
      correlationId: randomUUID(),
      traceparent,
      payload: {
        videoId,
        userId,
        fileName: 'demo.mp4',
        failureCode: 'INVALID_VIDEO',
        failureMessage: 'inválido',
        attempts: 1,
        failedAt: new Date().toISOString(),
      },
    });

    await expect(useCase.execute(envelope)).resolves.toBe('duplicate');
  });
});
