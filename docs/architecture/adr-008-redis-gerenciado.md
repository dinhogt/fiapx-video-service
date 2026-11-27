# ADR-008: Redis gerenciado (ElastiCache for Valkey) com o Postgres como fonte da verdade

| Campo | Valor |
|---|---|
| Status | Aceito (substitui a decisão D19) |
| Decisões | D24 |
| Relacionados | ADR-006, ADR-007; especificação B6 |

## Contexto
O Redis atende revogação de sessão, rate limit e cache da listagem. A proposta inicial (D19) era um Redis no cluster sem persistência: um reinício apagaria a revogação e reativaria tokens revogados por até 15 min. A decisão foi tornar o desenho robusto e persistente.

## Decisão
- **ElastiCache for Valkey** `cache.t4g.micro`, com primário + réplica Multi-AZ e failover automático, TLS em trânsito, AUTH token (Secrets Manager), SSE e snapshot diário.
- **Política de falha por uso:**

| Uso | Chave | Falha do Redis |
|---|---|---|
| Revogação | `revoked:sid:{sid}` | **fail-closed** (503) |
| Rate limit | `rl:login:*`, `rl:refresh:*` | **fail-closed** (429/503) |
| Cache da listagem | `videos:list:{userId}:{ver}:…` (TTL de 30 s) | **fail-open** (lê do Postgres) |

- A **revogação não depende do Redis**: o Postgres é a fonte da verdade, e o auth reidrata no boot e a cada 60 s os `sid` revogados nos últimos 15 min.
- No ambiente local: `redis:7 --appendonly yes` com volume.

## Alternativas
| Opção | Por que não |
|---|---|
| Redis no cluster (D19) | Ponto único de falha e perda da revogação |
| ElastiCache sem reidratação | O failover ou um flush perderia revogações |
| Revogação só no Postgres | Uma consulta ao banco do auth a cada request violaria o database-per-service |
| ElastiCache Serverless | Custo mínimo maior |

## Consequências
- Redis indisponível torna a API indisponível (fail-closed), e isso é intencional: segurança acima de disponibilidade. Há alerta e runbook.
- Custo de cerca de 0,8 USD/dia (2 nós).

## Governance
| # | Resposta |
|---|---|
| 1 | Neutra (gerenciado) |
| 2 | Sim |
| 3 | Redis no cluster rejeitado (D24) |
| 4 | Sim (ioredis) |
| 5 | Cerca de 0,8 USD/dia |
| 6 | Escala para cluster mode em 100 mil+ |

**Classificação: Recomendada** (Redis é Recomendada na lib).
