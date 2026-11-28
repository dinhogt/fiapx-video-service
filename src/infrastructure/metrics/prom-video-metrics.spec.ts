import { PromVideoMetrics } from './prom-video-metrics';
import { metricsRegistry } from './registry';

describe('PromVideoMetrics', () => {
  it('increments videos_uploaded_total and videos_processed_total', async () => {
    const metrics = new PromVideoMetrics();
    metrics.recordUpload();
    metrics.recordProcessed('COMPLETED');
    metrics.recordProcessed('FAILED');
    metrics.recordProcessed('PROCESSING');

    const body = await metricsRegistry.metrics();
    expect(body).toContain('videos_uploaded_total');
    expect(body).toContain('videos_processed_total');
    expect(body).toMatch(/videos_processed_total\{status="COMPLETED"\}/);
    expect(body).toMatch(/videos_processed_total\{status="FAILED"\}/);
    expect(body).toMatch(/videos_processed_total\{status="PROCESSING"\}/);
  });
});
