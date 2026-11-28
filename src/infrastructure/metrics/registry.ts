import { collectDefaultMetrics, Counter, Gauge, Registry } from 'prom-client';

/** Shared Prometheus registry for `/metrics` (ADR-011). */
export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });

export const videosUploadedTotal = new Counter({
  name: 'videos_uploaded_total',
  help: 'Total de vídeos criados (POST /videos)',
  registers: [metricsRegistry],
});

export const videosProcessedTotal = new Counter({
  name: 'videos_processed_total',
  help: 'Eventos de status de vídeo aplicados com sucesso',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

export const outboxPendingTotal = new Gauge({
  name: 'outbox_pending_total',
  help: 'Linhas na outbox ainda não publicadas',
  registers: [metricsRegistry],
});

export const outboxOldestPendingSeconds = new Gauge({
  name: 'outbox_oldest_pending_seconds',
  help: 'Idade em segundos da outbox pendente mais antiga',
  registers: [metricsRegistry],
});
