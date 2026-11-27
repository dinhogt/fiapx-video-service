# Solution design: FIAP X Video Processor

| Campo | Valor |
|---|---|
| Status | Aceito (Entrega 1) |
| Base | [requirements](../requirements/requirements.md), [especificação técnica](../05-especificacao-tecnica.md), ADRs 001–015 |
| Diagramas | [diagrams.md](diagrams.md) |

## 1. Visão geral
O usuário autentica, solicita um upload, envia o vídeo **direto ao S3**, confirma e acompanha o status. A confirmação grava o comando na **outbox**, e um relay publica no **SQS**. Um pool de **workers** que escala pela profundidade da fila extrai os frames em janelas, gera o zip em streaming no S3 e publica eventos no **SNS**. O video-service atualiza o status e o notification-service envia e-mail em caso de falha.

## 2. Componentes
| Componente | Tipo | Responsabilidade | ADR |
|---|---|---|---|
| API Gateway HTTP | Borda | TLS, JWT authorizer, throttling, roteamento | 006, 009 |
| auth-service | NestJS | Usuários, sessão, JWKS, `user.registered` (outbox) | 006 |
| video-service | NestJS | Upload e download pré-assinados, confirm (outbox), status, listagem com cache, consumidor de status, expiração | 004, 005 |
| video-worker | NestJS (standalone) | ffprobe/ffmpeg em janelas, zip, eventos, heartbeat. Roda no pool spot dedicado. | 014 |
| notification-service | NestJS (standalone) | Réplica de contato, e-mail de falha | 012 |
| SQS/SNS | Gerenciado | Comandos, eventos e DLQs | 003 |
| RDS PostgreSQL | Gerenciado | Schemas `auth`, `video`, `notification` | 007 |
| ElastiCache Valkey | Gerenciado | Revogação, rate limit, cache | 008 |
| S3 | Gerenciado | `raw/` e `output/` | 005 |
| SES | Gerenciado | E-mail | 012 |
| Alloy, Prometheus, Loki, Tempo, Grafana | No cluster | Observabilidade | 011 |

## 3. Propriedade dos dados
| Dado | Dono | Outros serviços acessam via |
|---|---|---|
| Usuário e credenciais | auth | JWT (`sub`) e evento `user.registered` |
| Sessão e revogação | auth | Redis `revoked:sid:*` (somente leitura) |
| Vídeo e status | video | API HTTP (cliente) e eventos (worker → video) |
| Arquivo bruto e zip | video (chaves) e worker (conteúdo) | Comando `video.process` (chaves) |
| Contato para e-mail | notification (réplica) | — |

## 4. Fluxos principais
| Fluxo | Resumo | Diagrama |
|---|---|---|
| F1 Login e refresh | Login emite o par de tokens. O refresh rotaciona; reuso revoga o `sid`; o logout revoga. | Seq. 2 |
| F2 + F3 Upload → processamento | create → POST no S3 → confirm (outbox) → SQS → worker → `processed` → status | Seq. 1 |
| F6 Falha | Permanente: `failed` imediato. Transitória: retry e `failed` na 3ª tentativa. Depois, `notifications` → e-mail. | Seq. 3 |
| F4/F5 Listagem e download | Cache por versão do usuário. Download pré-assinado só para o dono e se COMPLETED. | Seq. 1 |

## 5. Atendimento aos requisitos não funcionais
| RNF | Mecanismo |
|---|---|
| RNF-01 Durabilidade | Outbox + relay, SQS com DLQ, inbox, alerta de QUEUED parado |
| RNF-02 Picos | Upload fora da API, throttling 429 no gateway, backlog na fila |
| RNF-03 Escala | HPA (APIs), KEDA (worker 1–9, 1 job por pod), Cluster Autoscaler (pool `apps` t3.medium 2–3 + pool `worker` spot xlarge 1–3) |
| RNF-04 Resiliência | Heartbeat, 3 tentativas, falha permanente vs transitória, idempotência, graceful shutdown |
| RNF-05 Persistência | RDS + Prisma migrations + `init.sql`, lifecycle no S3 |
| RNF-06/07 Segurança | ADR-006, threat model, controls matrix, filtro por `userId` (404) |
| RNF-08/09 Qualidade e CI/CD | ADR-013, gates B15 |
| RNF-10 Observabilidade | ADR-011 |
| RNF-11 Containers | Multi-stage, non-root, read-only, probes, limits |
| RNF-12 Custo | [cost plan](../finops/implementation-cost-plan.md) |
| RNF-13 Ambiente local | ADR-010 |

## 6. Modos de falha
| Falha | Efeito | Comportamento |
|---|---|---|
| Pod do worker morre no meio do job | A mensagem reaparece depois do VT | Outro worker reprocessa. Se o zip já existir, só republica o evento. |
| SNS ou SQS indisponível | O relay não publica | A outbox acumula e o alerta `OutboxLagging` dispara. Nada se perde. |
| Redis indisponível | Auth e rate limit param | 503 fail-closed. A listagem lê do banco. Alerta `RedisUnavailable`. |
| RDS indisponível | APIs param | Readiness falha e o gateway devolve 503. As mensagens ficam na fila. |
| Vídeo malicioso ou corrompido | ffprobe ou ffmpeg falha | `INVALID_VIDEO`, sem retry. O processo fica isolado por limites do pod. |
| Notification sem contato | E-mail atrasado | Retry e, depois, DLQ com alarme |

## 7. Escala por tier (Governance)
| Tier | Usuários | Abordagem | Custo mensal estimado |
|---|---|---|---|
| Demo | < 10 | Homolog efêmera (este projeto) | cerca de 10,5 USD por dia ligado |
| Growth | 1.000 | Mesmo desenho, RDS Multi-AZ, nós spot para o worker | 300 a 500 USD |
| Scale | 10.000 | Karpenter, réplica de leitura, CloudFront no download | 1 mil a 3 mil USD |
| Enterprise | 100.000 | Banco por serviço, worker por classe de vídeo, Redis cluster | 5 mil a 15 mil USD |
