import { Injectable } from '@nestjs/common';
import type { ProcessedStatusLabel, VideoMetrics } from '../../domain/ports/video-metrics';
import { videosProcessedTotal, videosUploadedTotal } from './registry';

@Injectable()
export class PromVideoMetrics implements VideoMetrics {
  recordUpload(): void {
    videosUploadedTotal.inc();
  }

  recordProcessed(status: ProcessedStatusLabel): void {
    videosProcessedTotal.inc({ status });
  }
}
