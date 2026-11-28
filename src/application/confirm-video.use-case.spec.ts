/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { ConfirmVideoUseCase } from './confirm-video.use-case';
import { Fps } from '../domain/fps';
import type { ObjectStoragePort } from '../domain/ports/object-storage';
import type { VideoRepository } from '../domain/ports/video-repository';
import { Video } from '../domain/video';
import { VideoFile } from '../domain/video-file';

const userId = '11111111-1111-4111-8111-111111111111';
const videoId = '22222222-2222-4222-8222-222222222222';
const correlationId = '33333333-3333-4333-8333-333333333333';
const queueUrl = 'http://localhost:4566/000000000000/fiapx-local-video-process';
const traceparent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

function makeVideo(status: Video['status'] = 'PENDING_UPLOAD'): Video {
  const file = VideoFile.create({
    fileName: 'demo.mp4',
    contentType: 'video/mp4',
    sizeBytes: 1024,
  });
  if (!file.ok) {
    throw new Error('fixture');
  }
  const fps = Fps.create(1);
  if (!fps.ok) {
    throw new Error('fixture');
  }
  if (status === 'PENDING_UPLOAD') {
    return Video.create({
      id: videoId,
      userId,
      file: file.value,
      fps: fps.value,
      inputKey: `raw/${userId}/${videoId}.mp4`,
      correlationId,
    });
  }
  const video = Video.create({
    id: videoId,
    userId,
    file: file.value,
    fps: fps.value,
    inputKey: `raw/${userId}/${videoId}.mp4`,
    correlationId,
  });
  if (status === 'QUEUED') {
    video.queue();
  } else if (status === 'EXPIRED') {
    video.expire();
  } else if (status === 'PROCESSING') {
    video.queue();
    video.markProcessing();
  }
  return video;
}

function makeRepo(overrides: Partial<VideoRepository> = {}): VideoRepository {
  return {
    save: jest.fn(async () => undefined),
    findById: jest.fn(async () => null),
    findByIdForUser: jest.fn(async () => makeVideo()),
    queueWithOutbox: jest.fn(async () => undefined),
    countOutboxByAggregate: jest.fn(async () => 0),
    ...overrides,
  };
}

function makeStorage(exists = true): ObjectStoragePort {
  return { exists: jest.fn(async () => exists) };
}

describe('ConfirmVideoUseCase (AC-21 / AC-22 / AC-23)', () => {
  it('AC-21: queues video and writes video.process to outbox in one call', async () => {
    const videos = makeRepo();
    const storage = makeStorage(true);
    const useCase = new ConfirmVideoUseCase(videos, storage);

    const result = await useCase.execute({
      videoId,
      userId,
      bucket: 'fiapx-local-videos',
      processQueueUrl: queueUrl,
      traceparent,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.status).toBe('QUEUED');
    expect(storage.exists).toHaveBeenCalledWith(
      'fiapx-local-videos',
      `raw/${userId}/${videoId}.mp4`,
    );
    expect(videos.queueWithOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ id: videoId, status: 'QUEUED' }),
      expect.objectContaining({
        aggregateId: videoId,
        type: 'video.process',
        destination: queueUrl,
        payload: expect.objectContaining({
          type: 'video.process',
          payload: expect.objectContaining({
            videoId,
            userId,
            inputKey: `raw/${userId}/${videoId}.mp4`,
            outputKey: `output/${userId}/${videoId}/frames.zip`,
            fps: 1,
            fileName: 'demo.mp4',
          }),
        }),
      }),
    );
  });

  it('AC-22: missing S3 object → OBJECT_MISSING and no outbox', async () => {
    const videos = makeRepo();
    const storage = makeStorage(false);
    const useCase = new ConfirmVideoUseCase(videos, storage);

    const result = await useCase.execute({
      videoId,
      userId,
      bucket: 'fiapx-local-videos',
      processQueueUrl: queueUrl,
      traceparent,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('OBJECT_MISSING');
    expect(videos.queueWithOutbox).not.toHaveBeenCalled();
  });

  it('AC-23: second confirm on QUEUED returns current status without new outbox', async () => {
    const videos = makeRepo({
      findByIdForUser: jest.fn(async () => makeVideo('QUEUED')),
    });
    const storage = makeStorage(true);
    const useCase = new ConfirmVideoUseCase(videos, storage);

    const result = await useCase.execute({
      videoId,
      userId,
      bucket: 'fiapx-local-videos',
      processQueueUrl: queueUrl,
      traceparent,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.status).toBe('QUEUED');
    expect(storage.exists).not.toHaveBeenCalled();
    expect(videos.queueWithOutbox).not.toHaveBeenCalled();
  });

  it('EXPIRED → VIDEO_EXPIRED', async () => {
    const videos = makeRepo({
      findByIdForUser: jest.fn(async () => makeVideo('EXPIRED')),
    });
    const useCase = new ConfirmVideoUseCase(videos, makeStorage());

    const result = await useCase.execute({
      videoId,
      userId,
      bucket: 'fiapx-local-videos',
      processQueueUrl: queueUrl,
      traceparent,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('VIDEO_EXPIRED');
  });

  it('unknown video → VIDEO_NOT_FOUND', async () => {
    const videos = makeRepo({
      findByIdForUser: jest.fn(async () => null),
    });
    const useCase = new ConfirmVideoUseCase(videos, makeStorage());

    const result = await useCase.execute({
      videoId,
      userId,
      bucket: 'fiapx-local-videos',
      processQueueUrl: queueUrl,
      traceparent,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('VIDEO_NOT_FOUND');
  });
});
