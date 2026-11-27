# ADR-003: Mensageria com SQS para comandos e SNS → SQS para eventos

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D02, D14, D18 |
| Relacionados | ADR-004, ADR-010; especificação B2, B3 e B8; modelo: ADR-015 |

## Contexto
É preciso absorver picos sem perder requisições, processar vários vídeos em paralelo (competing consumers) e distribuir eventos de status e falha para mais de um consumidor. O enunciado sugere RabbitMQ, Kafka "ou similar".

## Decisão
- **Comando** `video.process` vai para a fila SQS Standard `video-process` (VT 120 s, `maxReceiveCount` 3, DLQ).
- **Eventos** `video.processing`, `video.processed` e `video.failed` vão para o tópico SNS `video-events`, com fan-out para:
  - a fila `video-status-updates` (video-service);
  - a fila `notifications`, com filtro `type = video.failed`.
- O evento `user.registered` vai para o SNS `user-events` e chega à fila `user-contacts` (notification).
- Todas as filas têm DLQ, SSE, long polling e raw delivery.
- O envelope v1 é versionado no pacote `@dinhogt/fiapx-contracts` e validado com zod no consumo.
- A entrega é **at-least-once**. Os consumidores são idempotentes (ADR-004) e a atualização de status é monotônica.

## Alternativas
| Opção | Por que não |
|---|---|
| RabbitMQ (Amazon MQ ou no cluster) | Custo do broker gerenciado, ou mais um stateful para operar no cluster. O modelo não tem esse padrão pronto. |
| Kafka/MSK | Custo e complexidade desproporcionais. Ordem e replay não são necessários. |
| SQS FIFO | Throughput limitado. Ordem global é desnecessária, porque a máquina de estados já tolera desordem. |
| Só SQS, sem SNS | O produtor ficaria acoplado a cada consumidor |

## Consequências
- O pico vira backlog na fila. O KEDA escala o worker pela profundidade (ADR-009).
- Não há ordem garantida, o que é tratado com transições monotônicas e inbox.
- No ambiente local, o LocalStack emula SQS e SNS com o mesmo SDK (ADR-010).
- Mensagens na DLQ disparam alarme e têm runbook de redrive.

## Governance
| # | Resposta |
|---|---|
| 1 | Reduz: serviço gerenciado, sem broker para operar |
| 2 | Sim |
| 3 | Fila só em Redis (BullMQ) rejeitada: menor durabilidade e sem fan-out nativo |
| 4 | Sim (AWS SDK v3) |
| 5 | Centavos no volume da demo |
| 6 | SQS e SNS escalam sem mudança até 100 mil+ |

**Classificação: Recomendada** (dentro da exceção AWS do ADR-015).
