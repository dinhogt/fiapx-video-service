/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { encodeVideoCursor } from './video-cursor';
import { ListVideosUseCase } from './list-videos.use-case';
import { Fps } from '../domain/fps';
import type { VideoListCache } from '../domain/ports/video-list-cache';
import type { VideoRepository } from '../domain/ports/video-repository';
import { Video } from '../domain/video';
import { VideoFile } from '../domain/video-file';

const userId = '11111111-1111-4111-8111-111111111111';

function makeVideo(id: string, createdAt: Date): Video {
  const file = VideoFile.create({
    fileName: `${id}.mp4`,
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
  return Video.create({
    id,
    userId,
    file: file.value,
    fps: fps.value,
    inputKey: `raw/${userId}/${id}.mp4`,
    now: createdAt,
  });
}

function makeCache(overrides: Partial<VideoListCache> = {}): VideoListCache {
  return {
    getVersion: jest.fn(async () => '0'),
    bumpVersion: jest.fn(async () => undefined),
    getList: jest.fn(async () => null),
    setList: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('ListVideosUseCase (AC-40)', () => {
  it('returns only page items with nextCursor when more remain', async () => {
    const t1 = new Date('2026-11-28T10:00:00.000Z');
    const t2 = new Date('2026-11-28T09:00:00.000Z');
    const t3 = new Date('2026-11-28T08:00:00.000Z');
    const v1 = makeVideo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', t1);
    const v2 = makeVideo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', t2);
    const v3 = makeVideo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', t3);
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => [v1, v2, v3]),
      recordInboxAndMaybeUpdate: jest.fn(async () => 'saved' as const),
    };
    const cache = makeCache();
    const useCase = new ListVideosUseCase(videos, cache);

    const result = await useCase.execute({ userId, limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.items).toHaveLength(2);
    expect(result.value.items[0]?.videoId).toBe(v1.id);
    expect(result.value.nextCursor).toBe(encodeVideoCursor(v2.createdAt, v2.id));
    expect(cache.setList).toHaveBeenCalled();
  });

  it('serves from cache when present', async () => {
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
      recordInboxAndMaybeUpdate: jest.fn(async () => 'saved' as const),
    };
    const cached = { items: [], nextCursor: null };
    const cache = makeCache({
      getList: jest.fn(async () => cached),
    });
    const useCase = new ListVideosUseCase(videos, cache);
    const result = await useCase.execute({ userId, limit: 20 });
    expect(result.ok).toBe(true);
    expect(videos.listByUser).not.toHaveBeenCalled();
  });

  it('rejects invalid limit and cursor', async () => {
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
      recordInboxAndMaybeUpdate: jest.fn(async () => 'saved' as const),
    };
    const useCase = new ListVideosUseCase(videos, makeCache());
    await expect(useCase.execute({ userId, limit: 0 })).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_LIMIT',
    });
    await expect(useCase.execute({ userId, cursor: '!!!' })).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_CURSOR',
    });
  });
});
