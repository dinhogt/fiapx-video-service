/* eslint-disable @typescript-eslint/require-await */
import { RedisService } from './redis.service';
import type { VideoEnv } from '../config/env';

jest.mock('ioredis', () => {
  const quit = jest.fn(async () => 'OK');
  const on = jest.fn();
  return jest.fn().mockImplementation(() => ({ quit, on }));
});

describe('RedisService', () => {
  it('creates a client and quits on destroy', async () => {
    const service = new RedisService({ REDIS_URL: 'redis://localhost:6379' } as VideoEnv);
    expect(service.client).toBeDefined();
    await service.onModuleDestroy();
  });
});
