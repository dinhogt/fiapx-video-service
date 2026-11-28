import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { VideoListCache } from '../../domain/ports/video-list-cache';
import type { VideoEnv } from '../config/env';
import { APP_ENV_CONFIG, VIDEO_LIST_CACHE } from '../config/tokens';
import { PrismaService } from '../prisma/prisma.service';
import { ADVISORY_LOCK_KEYS, advisoryUnlock, tryAdvisoryLock } from './advisory-lock';

const INTERVAL_MS = 3_600_000;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ExpirePendingUploadsJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpirePendingUploadsJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(VIDEO_LIST_CACHE) private readonly listCache: VideoListCache,
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
   * Marks PENDING_UPLOAD older than 24 h as EXPIRED (RF-15 / B3).
   * `now` is injectable for controlled-clock integration tests.
   */
  async run(now: Date = new Date()): Promise<number> {
    if (this.stopped || this.running) {
      return 0;
    }
    this.running = true;
    try {
      const locked = await tryAdvisoryLock(
        this.prisma,
        ADVISORY_LOCK_KEYS.EXPIRE_PENDING_UPLOADS,
      );
      if (!locked) {
        return 0;
      }

      try {
        const cutoff = new Date(now.getTime() - PENDING_TTL_MS);
        const stale = await this.prisma.video.findMany({
          where: {
            status: 'PENDING_UPLOAD',
            createdAt: { lt: cutoff },
          },
          select: { id: true, userId: true },
        });
        if (stale.length === 0) {
          return 0;
        }

        const ids = stale.map((row) => row.id);
        const result = await this.prisma.video.updateMany({
          where: {
            id: { in: ids },
            status: 'PENDING_UPLOAD',
          },
          data: {
            status: 'EXPIRED',
            updatedAt: now,
          },
        });

        const userIds = [...new Set(stale.map((row) => row.userId))];
        await Promise.all(userIds.map((userId) => this.listCache.bumpVersion(userId)));

        this.logger.log(`Expired ${result.count} pending upload(s)`);
        return result.count;
      } finally {
        try {
          await advisoryUnlock(this.prisma, ADVISORY_LOCK_KEYS.EXPIRE_PENDING_UPLOADS);
        } catch {
          // Best-effort unlock during shutdown/teardown.
        }
      }
    } finally {
      this.running = false;
    }
  }
}
