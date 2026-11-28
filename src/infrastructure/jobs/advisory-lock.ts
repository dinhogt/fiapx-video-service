import type { PrismaService } from '../prisma/prisma.service';

/** Stable Postgres advisory-lock keys for periodic jobs (E-05). */
export const ADVISORY_LOCK_KEYS = {
  EXPIRE_PENDING_UPLOADS: 826_402_001,
  HOUSEKEEPING: 826_402_002,
} as const;

export async function tryAdvisoryLock(prisma: PrismaService, key: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(${key}) AS locked
  `;
  return Boolean(rows[0]?.locked);
}

export async function advisoryUnlock(prisma: PrismaService, key: number): Promise<void> {
  await prisma.$queryRaw`SELECT pg_advisory_unlock(${key})`;
}
