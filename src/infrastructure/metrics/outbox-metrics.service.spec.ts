/* eslint-disable @typescript-eslint/require-await */
import { OutboxMetricsService } from './outbox-metrics.service';
import { metricsRegistry } from './registry';
import type { PrismaService } from '../prisma/prisma.service';

describe('OutboxMetricsService', () => {
  it('sets outbox gauges from SQL stats', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ pending_total: 3, oldest_seconds: 42 }]),
    } as unknown as PrismaService;
    const service = new OutboxMetricsService(prisma);
    await service.refresh();

    const body = await metricsRegistry.metrics();
    expect(body).toContain('outbox_pending_total 3');
    expect(body).toContain('outbox_oldest_pending_seconds 42');
  });

  it('defaults to zero when the query returns no rows', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => []),
    } as unknown as PrismaService;
    await new OutboxMetricsService(prisma).refresh();
    const body = await metricsRegistry.metrics();
    expect(body).toMatch(/outbox_pending_total 0/);
    expect(body).toMatch(/outbox_oldest_pending_seconds 0/);
  });
});
