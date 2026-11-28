/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { HousekeepingJob } from './housekeeping.job';
import type { VideoEnv } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';

describe('HousekeepingJob', () => {
  const env = { APP_ENV: 'test', NODE_ENV: 'test' } as VideoEnv;

  it('deletes old published outbox and old inbox (E-04)', async () => {
    const now = new Date('2026-11-28T12:00:00.000Z');
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ unlocked: true }]),
      outbox: {
        deleteMany: jest.fn(async () => ({ count: 2 })),
      },
      inbox: {
        deleteMany: jest.fn(async () => ({ count: 5 })),
      },
    } as unknown as PrismaService;
    const job = new HousekeepingJob(prisma, env);

    await expect(job.run(now)).resolves.toEqual({ outboxDeleted: 2, inboxDeleted: 5 });

    expect(prisma.outbox.deleteMany).toHaveBeenCalledWith({
      where: {
        publishedAt: {
          not: null,
          lt: new Date('2026-11-21T12:00:00.000Z'),
        },
      },
    });
    expect(prisma.inbox.deleteMany).toHaveBeenCalledWith({
      where: {
        processedAt: { lt: new Date('2026-11-14T12:00:00.000Z') },
      },
    });
  });

  it('skips when advisory lock is held elsewhere', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ locked: false }]),
      outbox: { deleteMany: jest.fn() },
      inbox: { deleteMany: jest.fn() },
    } as unknown as PrismaService;
    const job = new HousekeepingJob(prisma, env);

    await expect(job.run()).resolves.toEqual({ outboxDeleted: 0, inboxDeleted: 0 });
    expect(prisma.outbox.deleteMany).not.toHaveBeenCalled();
    expect(prisma.inbox.deleteMany).not.toHaveBeenCalled();
  });

  it('onModuleInit is a no-op in test env', () => {
    const prisma = { $queryRaw: jest.fn() } as unknown as PrismaService;
    const job = new HousekeepingJob(prisma, env);
    job.onModuleInit();
    job.onModuleDestroy();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
