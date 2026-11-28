import { advisoryUnlock, tryAdvisoryLock } from './advisory-lock';
import type { PrismaService } from '../prisma/prisma.service';

describe('advisory-lock', () => {
  it('tryAdvisoryLock returns the postgres boolean', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([{ locked: true }]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    await expect(tryAdvisoryLock(prisma, 1)).resolves.toBe(true);

    queryRaw.mockResolvedValueOnce([{ locked: false }]);
    await expect(tryAdvisoryLock(prisma, 1)).resolves.toBe(false);

    queryRaw.mockResolvedValueOnce([]);
    await expect(tryAdvisoryLock(prisma, 1)).resolves.toBe(false);
  });

  it('advisoryUnlock issues unlock', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([{ unlocked: true }]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    await advisoryUnlock(prisma, 42);
    expect(queryRaw).toHaveBeenCalled();
  });
});
