# WBS: FIAP X Video Processor

O projeto é solo e tem cerca de 3 semanas. Datas relativas ao início em 2026-11-19.

| Pacote | Entrega | Saída | Dependência | Gate | Semana |
|---|---|---|---|---|---|
| 0.1 Governança | 0 | `global-rules.override.yaml` com complex/high/mvp/80 | — | complexity-intake | 1 |
| 0.2 Requisitos | 0 | requirements + acceptance-criteria (F1–F10) | 0.1 | requirements-quality | 1 |
| 0.3 Planejamento | 0 | épicos + WBS + rastreabilidade | 0.2 | complexity-intake | 1 |
| 1.1 Arquitetura | 1 | ADRs 001–013 + solution design + diagramas C4/sequência | E0 | architecture-quality | 1 |
| 1.2 Contratos | 1 | API contract (OpenAPI) + contrato de mensageria | 1.1 | architecture-quality | 1 |
| 1.3 Cloud | 1 | avaliação de opções AWS + overview | 1.1 | cloud-selection | 1 |
| 1.4 Segurança | 1 | threat model + controls matrix | 1.1–1.3 | security-review | 1 |
| 1.5 FinOps | 1 | plano de custo e de destruição | 1.3 | finops-cost | 1 |
| 2 Fundação | 2 | 5 repos, skeleton NestJS, lint/jest/Docker, CI base, pacote de contratos, `docker-compose` | E1 | infrastructure-quality | 1 |
| 3 Auth | 3 | auth-service: cadastro, login, refresh rotativo, logout, JWKS, revogação por sid, rate limit | 2 | implementation + security | 1–2 |
| 4 Video | 4 | video-service: presigned, confirm, outbox/relay, listagem, download, consumer | 2, 3 | implementation | 2 |
| 5 Worker | 5 | video-worker: ffprobe/ffmpeg, zip em streaming, idempotência, heartbeat | 2 | implementation | 2 |
| 6 Notification | 6 | notification-service: consumer + SES/Mailpit | 2 | implementation | 2 |
| 7 Integração | 7 | BDD e2e local, k6 de pico, cobertura ≥ 80% | 3–6 | release-quality | 2 |
| 8 Plataforma AWS | 8 | Terraform data/platform, CD OIDC, KEDA, rollback | 7 | infrastructure-quality | 3 |
| 9 Observabilidade | 9 | métricas, traces, dashboard, alertas + runbooks | 7, 8 | observability-quality | 3 |
| 10 Pacote final | 10 | QA go/no-go, `artifacts.md`, Postman, roteiro e gravação do vídeo, destroy | 8, 9 | release-quality | 3 |

## Marcos
1. **M0:** governança e requisitos fechados (fim da E0).
2. **M1:** ADRs, contratos e threat model aprovados. A partir daí o código começa (fim da E1).
3. **M2:** fluxo feliz e fluxo de falha rodando localmente, ponta a ponta (fim da E7).
4. **M3:** homolog na AWS com CD, dashboards e k6 (fim das E8 e E9).
5. **M4:** vídeo gravado e entrega submetida (fim da E10).

## Dependências externas
- Conta AWS pessoal com budget aprovado para `terraform apply` e SES (sandbox, com remetente verificado).
- Conta SonarCloud (org dinhogt) e `SONAR_TOKEN` nos repos.
- Roles de GitHub OIDC criadas antes do CD.

## Plano de corte (se o prazo apertar)
Ordem de corte: RF-15 → KEDA (fica o HPA por CPU) → cache Redis (fica só o rate limit) → deploy AWS completo (fica `terraform plan` no CI + demo local).
