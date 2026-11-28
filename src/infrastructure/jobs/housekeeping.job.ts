import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { VideoEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';
import { PrismaService } from '../prisma/prisma.service';
import { ADVISORY_LOCK_KEYS, advisoryUnlock, tryAdvisoryLock } from './advisory-lock';

const INTERVAL_MS = 3_600_000;
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const INBOX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export type HousekeepingResult = {
  outboxDeleted: number;
  inboxDeleted: number;
};

@Injectable()
export class HousekeepingJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HousekeepingJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_ENV_CONFIG) private readonly env: VideoEnv,
  ) {}

  onModuleInit(): void {
    if (this.env.APP_ENV === 'test' || this.env.NODE_ENV === 'test') {
      return;
    }
    void this.run();
    this.timer = setInterval(() => {
      void this.run();
    }, INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Deletes published outbox (>7d) and processed inbox (>14d) (E-04).
   * `now` is injectable for controlled-clock integration tests.
   */
  async run(now: Date = new Date()): Promise<HousekeepingResult> {
    const empty: HousekeepingResult = { outboxDeleted: 0, inboxDeleted: 0 };
    if (this.stopped || this.running) {
      return empty;
    }
    this.running = true;
    try {
      const locked = await tryAdvisoryLock(this.prisma, ADVISORY_LOCK_KEYS.HOUSEKEEPING);
      if (!locked) {
        return empty;
      }

      try {
        const outboxCutoff = new Date(now.getTime() - OUTBOX_RETENTION_MS);
        const inboxCutoff = new Date(now.getTime() - INBOX_RETENTION_MS);

        const [outbox, inbox] = await Promise.all([
          this.prisma.outbox.deleteMany({
            where: {
              publishedAt: { not: null, lt: outboxCutoff },
            },
          }),
          this.prisma.inbox.deleteMany({
            where: {
              processedAt: { lt: inboxCutoff },
            },
          }),
        ]);

        this.logger.log(
          `Housekeeping deleted outbox=${outbox.count} inbox=${inbox.count}`,
        );
        return { outboxDeleted: outbox.count, inboxDeleted: inbox.count };
      } finally {
        try {
          await advisoryUnlock(this.prisma, ADVISORY_LOCK_KEYS.HOUSEKEEPING);
        } catch {
          // Best-effort unlock during shutdown/teardown.
        }
      }
    } finally {
      this.running = false;
    }
  }
}
