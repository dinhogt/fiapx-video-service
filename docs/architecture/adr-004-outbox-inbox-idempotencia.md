# ADR-004: Outbox transacional, inbox e idempotência

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D32 (T08); RNF-01, RNF-04 |
| Relacionados | ADR-003; especificação B3 e B6; modelo: outbox sem relay (corrigido aqui) |

## Contexto
"Não perder requisição" exige que um `202 Accepted` no confirm **sempre** resulte em mensagem na fila, mesmo que o pod caia logo depois do commit. O mesmo vale para `user.registered`. O SQS entrega at-least-once, então duplicatas vão acontecer.

## Decisão
- **Outbox transacional** no video-service e no auth-service:
  - a mudança de estado e a mensagem são gravadas na mesma transação Postgres;
  - um **relay em background** publica a cada 1 s com `FOR UPDATE SKIP LOCKED` (lotes de 50), o que é seguro com várias réplicas;
  - em falha: `attempts++` e `last_error`, com alerta quando `outbox_oldest_pending_seconds > 60`.
- **Inbox** (`message_id` PK) nos consumidores com banco (video-service e notification-service), gravada na mesma transação do efeito.
- **Worker sem banco:** a idempotência vem da existência de `output/.../frames.zip`. Se existir, ele republica `video.processed` e encerra.
- O confirm é idempotente: um segundo confirm devolve 202 com o status atual, sem mensagem nova.

## Alternativas
| Opção | Por que não |
|---|---|
| Publicar direto depois do commit | Uma janela de crash perde a mensagem e o vídeo fica preso em QUEUED |
| Publicar antes do commit | Publicaria mensagem de transação que pode sofrer rollback |
| CDC (Debezium) | Infraestrutura pesada demais |
| Despacho inline sem relay (modelo) | O pendente só sai na próxima chamada. **Defeito do modelo, corrigido.** |

## Consequências
- Latência extra de até cerca de 1 s entre o confirm e a fila.
- Pode haver duplicata residual (crash entre o publish e o commit), absorvida pela inbox e pela idempotência do worker.
- O código de outbox é compartilhado (o mesmo módulo nos dois serviços, via template).

## Governance
| # | Resposta |
|---|---|
| 1 | Aumenta pouco e garante um requisito obrigatório |
| 2 | Sim |
| 3 | A publicação direta foi rejeitada por violar o RNF-01 |
| 4 | Sim (padrão amplamente documentado) |
| 5 | Nulo |
| 6 | Com 10 mil+ usuários, particionar o relay ou adotar CDC |

**Classificação: Recomendada.**
