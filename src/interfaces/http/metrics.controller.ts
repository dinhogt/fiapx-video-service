import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../shared/jwt-auth';
import { OutboxMetricsService } from '../../infrastructure/metrics/outbox-metrics.service';
import { metricsRegistry } from '../../infrastructure/metrics/registry';

@Controller()
export class MetricsController {
  constructor(private readonly outboxMetrics: OutboxMetricsService) {}

  @Public()
  @Get('metrics')
  @Header('Content-Type', metricsRegistry.contentType)
  async metrics(): Promise<string> {
    await this.outboxMetrics.refresh();
    return metricsRegistry.metrics();
  }
}
