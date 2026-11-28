/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { ExpirePendingUploadsJob } from './expire-pending-uploads.job';
import type { VideoListCache } from '../../domain/ports/video-list-cache';
import type { VideoEnv } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';

describe('ExpirePendingUploadsJob', () => {
  const env = { APP_ENV: 'test', NODE_ENV: 'test' } as VideoEnv;

  function makeCache(): VideoListCache {
    return {
      getVersion: jest.fn(async () => '0'),
      bumpVersion: jest.fn(async () => undefined),
      getList: jest.fn(async () => null),
      setList: jest.fn(async () => undefined),
    };
  }

  it('expires PENDING_UPLOAD older than 24h and bumps list versions', async () => {
    const now = new Date('2026-11-28T12:00:00.000Z');
    const userA = '11111111-1111-4111-8111-111111111111';
    const userB = '22222222-2222-4222-8222-222222222222';
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ unlocked: true }]),
      video: {
        findMany: jest.fn(async () => [
          { id: 'v1', userId: userA },
          { id: 'v2', userId: userA },
          { id: 'v3', userId: userB },
        ]),
        updateMany: jest.fn(async () => ({ count: 3 })),
      },
    } as unknown as PrismaService;
    const cache = makeCache();
    const job = new ExpirePendingUploadsJob(prisma, cache, env);

    await expect(job.run(now)).resolves.toBe(3);

    expect(prisma.video.findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING_UPLOAD',
        createdAt: { lt: new Date('2026-11-27T12:00:00.000Z') },
      },
      select: { id: true, userId: true },
    });
    expect(prisma.video.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['v1', 'v2', 'v3'] },
        status: 'PENDING_UPLOAD',
      },
      data: { status: 'EXPIRED', updatedAt: now },
    });
    expect(cache.bumpVersion).toHaveBeenCalledTimes(2);
    expect(cache.bumpVersion).toHaveBeenCalledWith(userA);
    expect(cache.bumpVersion).toHaveBeenCalledWith(userB);
  });

  it('skips when advisory lock is held elsewhere', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ locked: false }]),
      video: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    } as unknown as PrismaService;
    const cache = makeCache();
    const job = new ExpirePendingUploadsJob(prisma, cache, env);

    await expect(job.run()).resolves.toBe(0);
    expect(prisma.video.findMany).not.toHaveBeenCalled();
    expect(cache.bumpVersion).not.toHaveBeenCalled();
  });

  it('returns 0 when nothing is stale', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ unlocked: true }]),
      video: {
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(),
      },
    } as unknown as PrismaService;
    const cache = makeCache();
    const job = new ExpirePendingUploadsJob(prisma, cache, env);

    await expect(job.run()).resolves.toBe(0);
    expect(prisma.video.updateMany).not.toHaveBeenCalled();
  });

  it('onModuleInit is a no-op in test env', () => {
    const prisma = { $queryRaw: jest.fn() } as unknown as PrismaService;
    const job = new ExpirePendingUploadsJob(prisma, makeCache(), env);
    job.onModuleInit();
    job.onModuleDestroy();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
