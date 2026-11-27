# Checklist de entrega: requisito do PDF → evidência

O executor preenche a coluna "Evidência" na tarefa F10.3. Todos os itens precisam estar ✅ antes de submeter.

## Requisitos funcionais
| Requisito do PDF | Atendido por | Evidência (preencher) | ✅ |
|---|---|---|---|
| Processar mais de um vídeo ao mesmo tempo | Worker com KEDA 1–9, D34, ADR-009/014 | Captura do Grafana com réplicas > 1 e k6 (`docs/qa/`) | ☐ |
| Não perder requisição em picos | Outbox + SQS + DLQ + idempotência, ADR-003/004 | Relatório k6: 50/50 em estado final; AC-70/71 | ☐ |
| Protegido por usuário e senha | auth-service, ADR-006 | BDD AC-10..18 verde | ☐ |
| Listagem de status dos vídeos do usuário | `GET /videos` | BDD AC-40; Postman | ☐ |
| Notificação em caso de erro | notification-service, ADR-012 | BDD AC-60; e-mail no Mailpit/SES | ☐ |

## Requisitos técnicos
| Requisito do PDF | Atendido por | Evidência (preencher) | ✅ |
|---|---|---|---|
| Persistir os dados | RDS PostgreSQL + Prisma, ADR-007 | `db/init.sql`, migrations | ☐ |
| Arquitetura escalável | HPA, KEDA, Cluster Autoscaler, ADR-009 | Dashboard e manifests | ☐ |
| Versionado no GitHub | 5 repos públicos | Links abaixo | ☐ |
| Testes que garantam a qualidade | Jest ≥ 80%, Testcontainers, BDD, k6 | SonarCloud dos 4 serviços, `docs/qa/validation-report.md` | ☐ |
| CI/CD | GitHub Actions + OIDC → EKS, rollback | Execuções verdes e AC-101 | ☐ |

## Stack recomendada
| Item | Escolha | Evidência | ✅ |
|---|---|---|---|
| Containers | Docker + Kubernetes (EKS) + Compose | Dockerfiles, `k8s/`, `docker-compose.yml` | ☐ |
| Mensageria | SQS/SNS ("similar", ADR-003) | `messaging` no Terraform, script do LocalStack | ☐ |
| Banco | PostgreSQL + Redis | ADR-007/008 | ☐ |
| Monitoramento | Prometheus + Grafana (+ Loki, Tempo) | Dashboard e alertas | ☐ |
| CI/CD | GitHub Actions | workflows | ☐ |

## Entregáveis
| Entregável | Local | ✅ |
|---|---|---|
| Documentação da arquitetura | `fiapx-video-service/docs/architecture/` (ADRs, solution design, diagramas PNG) | ☐ |
| Script de criação do banco | `fiapx-infra/db/init.sql` + `prisma/migrations` de cada serviço | ☐ |
| Script dos demais recursos | `fiapx-infra/` (Terraform) + `localstack/init/ready.d/10-resources.sh` | ☐ |
| Links do GitHub | `https://github.com/dinhogt/fiapx-{auth-service,video-service,video-worker,notification-service,infra}` | ☐ |
| Vídeo ≤ 10 min | Link (preencher) | ☐ |

## Gates da spec-skills-lib (complex-flow)
| Gate | Evidência | ✅ |
|---|---|---|
| complexity-intake / requirements-quality | `requirements/` (WBS, épicos, AC) | ✅ |
| architecture-quality | ADRs 001–015 | ✅ |
| cloud-selection / finops | `cloud/`, `finops/` | ✅ |
| security-review | `security/` | ✅ |
| infrastructure-quality | CI/CD + rollback documentado (`docs/infrastructure/`) | ☐ |
| implementation-quality | Testes e cobertura | ☐ |
| documentation-quality | `runbook.md`, `release-notes.md` | ☐ |
| observability-quality | `docs/observability/` (dashboards, alertas, tracing) | ☐ |
| release-quality | `docs/qa/validation-report.md` com go/no-go | ☐ |
