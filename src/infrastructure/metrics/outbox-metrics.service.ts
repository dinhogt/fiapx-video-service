import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { outboxOldestPendingSeconds, outboxPendingTotal } from './registry';

type OutboxStatsRow = {
  pending_total: number;
  oldest_seconds: number;
};

@Injectable()
export class OutboxMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Refresh outbox gauges before a Prometheus scrape (B6 / ADR-011). */
  async refresh(): Promise<void> {
    const rows = await this.prisma.$queryRaw<OutboxStatsRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS pending_total,
        COALESCE(
          EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int,
          0
        ) AS oldest_seconds
      FROM outbox
      WHERE published_at IS NULL
    `);
    const stats = rows[0] ?? { pending_total: 0, oldest_seconds: 0 };
    outboxPendingTotal.set(stats.pending_total);
    outboxOldestPendingSeconds.set(stats.oldest_seconds);
  }
}
