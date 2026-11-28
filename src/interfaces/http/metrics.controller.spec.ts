/* eslint-disable @typescript-eslint/require-await */
import { MetricsController } from './metrics.controller';
import type { OutboxMetricsService } from '../../infrastructure/metrics/outbox-metrics.service';

describe('MetricsController', () => {
  it('exposes prometheus default and business metric series', async () => {
    const refresh = jest.fn(async () => undefined);
    const outboxMetrics = { refresh } as unknown as OutboxMetricsService;
    const controller = new MetricsController(outboxMetrics);
    const body = await controller.metrics();
    expect(refresh).toHaveBeenCalled();
    expect(body).toContain('process_cpu');
    expect(body).toContain('videos_uploaded_total');
    expect(body).toContain('videos_processed_total');
    expect(body).toContain('outbox_pending_total');
    expect(body).toContain('outbox_oldest_pending_seconds');
  });
});
