/** Business metrics for the video journey (ADR-011). */
export type ProcessedStatusLabel = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface VideoMetrics {
  recordUpload(): void;
  recordProcessed(status: ProcessedStatusLabel): void;
}
