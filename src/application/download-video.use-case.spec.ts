/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import {
  DOWNLOAD_URL_TTL_SECONDS,
  DownloadVideoUseCase,
} from './download-video.use-case';
import { Fps } from '../domain/fps';
import type { PresignedDownloadPort } from '../domain/ports/presigned-download';
import type { VideoRepository } from '../domain/ports/video-repository';
import { Video } from '../domain/video';
import { VideoFile } from '../domain/video-file';
import { OUTPUT_TTL_MS } from '../domain/video-view';

const userId = '11111111-1111-4111-8111-111111111111';
const videoId = '22222222-2222-4222-8222-222222222222';

function makeCompleted(fileName = 'demo.mp4', completedAt = new Date('2026-11-28T12:00:00.000Z')): Video {
  const file = VideoFile.create({
    fileName,
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
  video.complete(
    {
      frameCount: 2,
      zipSizeBytes: 50n,
      outputKey: `output/${userId}/${videoId}/frames.zip`,
    },
    completedAt,
  );
  return video;
}

describe('DownloadVideoUseCase (AC-50 / AC-51 / E-03)', () => {
  it('AC-50: returns 5 min presigned GET with sanitized Content-Disposition', async () => {
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(async () => makeCompleted('clip.mp4')),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
    };
    const downloads: PresignedDownloadPort = {
      createGet: jest.fn(async () => ({
        url: 'http://localhost:4566/bucket/key?X-Amz-Signature=x',
        expiresAt: new Date('2026-11-28T12:05:00.000Z'),
      })),
    };
    const useCase = new DownloadVideoUseCase(videos, downloads);
    const result = await useCase.execute({
      videoId,
      userId,
      bucket: 'fiapx-local-videos',
      now: new Date('2026-11-28T12:01:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.url).toContain('localhost:4566');
    expect(downloads.createGet).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'fiapx-local-videos',
        key: `output/${userId}/${videoId}/frames.zip`,
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
        responseContentDisposition: expect.stringContaining('clip_frames.zip'),
      }),
    );
  });

  it('AC-51: not COMPLETED → NOT_COMPLETED', async () => {
    const pending = makeCompleted();
    // rehydrate as PENDING by creating fresh
    const file = VideoFile.create({
      fileName: 'x.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1,
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
      inputKey: 'raw/u/v.mp4',
    });
    void pending;
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(async () => video),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
    };
    const downloads: PresignedDownloadPort = { createGet: jest.fn() };
    const result = await new DownloadVideoUseCase(videos, downloads).execute({
      videoId,
      userId,
      bucket: 'b',
    });
    expect(result).toEqual({ ok: false, code: 'NOT_COMPLETED' });
    expect(downloads.createGet).not.toHaveBeenCalled();
  });

  it('E-03: after outputExpiresAt → OUTPUT_EXPIRED', async () => {
    const completedAt = new Date('2026-11-01T00:00:00.000Z');
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(async () => makeCompleted('demo.mp4', completedAt)),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
    };
    const downloads: PresignedDownloadPort = { createGet: jest.fn() };
    const now = new Date(completedAt.getTime() + OUTPUT_TTL_MS + 1);
    const result = await new DownloadVideoUseCase(videos, downloads).execute({
      videoId,
      userId,
      bucket: 'b',
      now,
    });
    expect(result).toEqual({ ok: false, code: 'OUTPUT_EXPIRED' });
  });

  it('missing video → VIDEO_NOT_FOUND', async () => {
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(async () => null),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
    };
    const result = await new DownloadVideoUseCase(videos, { createGet: jest.fn() }).execute({
      videoId,
      userId,
      bucket: 'b',
    });
    expect(result).toEqual({ ok: false, code: 'VIDEO_NOT_FOUND' });
  });

  it('COMPLETED without outputKey → NOT_COMPLETED', async () => {
    const video = makeCompleted();
    Object.defineProperty(video, 'outputKey', { get: () => null });
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(async () => video),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
    };
    const result = await new DownloadVideoUseCase(videos, { createGet: jest.fn() }).execute({
      videoId,
      userId,
      bucket: 'b',
    });
    expect(result).toEqual({ ok: false, code: 'NOT_COMPLETED' });
  });
});
