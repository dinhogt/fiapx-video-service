/* eslint-disable @typescript-eslint/require-await */
import { RedisVideoListCache } from './redis-video-list-cache';
import type { RedisService } from './redis.service';

describe('RedisVideoListCache', () => {
  it('getVersion returns 0 when missing', async () => {
    const redis = {
      client: {
        get: jest.fn(async () => null),
        incr: jest.fn(async () => 1),
        set: jest.fn(async () => 'OK'),
      },
    } as unknown as RedisService;
    const cache = new RedisVideoListCache(redis);
    await expect(cache.getVersion('u1')).resolves.toBe('0');
  });

  it('fail-opens on redis errors', async () => {
    const redis = {
      client: {
        get: jest.fn(async () => {
          throw new Error('down');
        }),
        incr: jest.fn(async () => {
          throw new Error('down');
        }),
        set: jest.fn(async () => {
          throw new Error('down');
        }),
      },
    } as unknown as RedisService;
    const cache = new RedisVideoListCache(redis);
    await expect(cache.getVersion('u1')).resolves.toBe('0');
    await expect(cache.bumpVersion('u1')).resolves.toBeUndefined();
    await expect(cache.getList('u1', '0', '', 20)).resolves.toBeNull();
    await expect(
      cache.setList('u1', '0', '', 20, { items: [], nextCursor: null }),
    ).resolves.toBeUndefined();
  });

  it('round-trips cached list page', async () => {
    const store = new Map<string, string>();
    const redis = {
      client: {
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        incr: jest.fn(async (key: string) => {
          const next = String(Number(store.get(key) ?? '0') + 1);
          store.set(key, next);
          return Number(next);
        }),
        set: jest.fn(async (key: string, value: string) => {
          store.set(key, value);
          return 'OK';
        }),
      },
    } as unknown as RedisService;
    const cache = new RedisVideoListCache(redis);
    const page = { items: [], nextCursor: null };
    await cache.setList('u1', '1', '', 20, page);
    await expect(cache.getList('u1', '1', '', 20)).resolves.toEqual(page);
    await cache.bumpVersion('u1');
    expect(store.get('videos:ver:u1')).toBe('1');
  });
});
