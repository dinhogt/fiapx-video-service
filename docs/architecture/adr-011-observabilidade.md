# ADR-011: Observabilidade com Prometheus, Loki, Tempo e Grafana via Alloy

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D06, D21, D31 (T07) |
| Relacionados | ADR-003, ADR-010; `docs/observability/` (Entrega 9) |

## Contexto
O enunciado recomenda Prometheus + Grafana. O gate da lib exige dashboards das jornadas críticas, alertas com runbook e traces dos fluxos principais. O modelo usava CloudWatch + X-Ray, que não funciona localmente.

## Decisão
- **Logs:** JSON (`nestjs-pino`) com `correlationId`, `trace_id`, `span_id`, `service` e `env`. Redaction de `password`, `refreshToken`, `authorization` e `email`. O Alloy coleta o stdout dos containers e envia ao **Loki**.
- **Métricas:** `/metrics` (`prom-client`) coletado pelo **Prometheus**. Métricas de negócio:
  - `videos_uploaded_total`, `videos_processed_total{status}`;
  - `video_processing_duration_seconds` (histograma), `frames_extracted_total`;
  - `outbox_pending_total`, `outbox_oldest_pending_seconds`;
  - fila e DLQ via `ApproximateNumberOfMessages*`, de um exporter SQS no worker.
- **Traces:** OTel SDK com auto-instrumentação, enviado ao Alloy por OTLP e dele ao **Tempo**. O `traceparent` vai no envelope da mensagem e liga API → fila → worker → evento → consumidores.
- **Grafana:** datasources e dashboard "FIAP X: jornada do vídeo" provisionados em JSON versionado. O log se conecta ao trace por `trace_id`.
- **Alertas** (Prometheus), cada um com runbook:

| Alerta | Condição |
|---|---|
| `DLQNotEmpty` | `dlq_messages > 0` por 1 min |
| `VideosStuckQueued` | vídeos em QUEUED há mais de 5 min |
| `HighFailureRate` | `failed / total > 10%` em 15 min |
| `OutboxLagging` | `outbox_oldest_pending_seconds > 60` |
| `ApiLatencyP95` | p95 acima de 300 ms (`performance_budget_ms` da lib), exceto o download |
| `RedisUnavailable` | erro de conexão ao Redis em qualquer serviço |

- No EKS: Helm `kube-prometheus-stack` (retenção de 2 dias), `loki` e `tempo` em modo single-binary, e `alloy` como DaemonSet, no namespace `observability`. Armazenamento em EBS gp3 pequeno.
- Os access logs do API Gateway são o único uso do CloudWatch.

## Alternativas
| Opção | Por que não |
|---|---|
| CloudWatch + X-Ray (modelo) | Sem paridade com o ambiente local e diverge da recomendação do enunciado |
| ELK | Elasticsearch pesado para os nós `t3.medium` |
| Jaeger | Mais uma interface. O Tempo integra ao Grafana. |
| OTel Collector + Promtail | Dois agentes, e o Promtail está em descontinuação (D31) |

## Consequências
- A stack de observabilidade consome cerca de 1,5 vCPU e 3 GiB no cluster, o que pesa no dimensionamento dos nós (ADR-009).
- A retenção é curta, aceitável porque homolog é efêmera.

## Governance
| # | Resposta |
|---|---|
| 1 | Aumenta, e é exigido pelo gate de observabilidade |
| 2 | Sim, configuração versionada |
| 3 | Só logs + métricas não atende o gate de traces |
| 4 | Sim |
| 5 | Roda nos nós existentes, sem custo SaaS |
| 6 | Em 100 mil, migrar para Grafana Cloud ou um backend gerenciado |

**Classificação: Recomendada.**
