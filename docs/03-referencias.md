# Análise das referências

## 1. Projeto base: `projeto-fiapx/` (Go 1.21 + Gin)
- Monolito num único `main.go`.
  - `POST /upload` processa o vídeo **de forma síncrona** dentro do request: `ffmpeg -vf fps=1`, PNGs e depois o zip em `outputs/`.
  - Também expõe `GET /download/:filename`, `GET /api/status` (lista todos os zips, sem distinguir usuário) e uma página HTML embutida.
- Problemas encontrados:
  - sem autenticação, banco, fila ou testes;
  - disco local, o que impede escalar horizontalmente;
  - CORS `*`;
  - `filename` sem sanitização no download (path traversal);
  - mensagens de erro expõem a saída do ffmpeg;
  - o Dockerfile roda `go run` como root, sem multi-stage.

## 2. Projeto modelo: `../autoservicemanager-repos/`
Repos: app (OS + saga + docs canônicas), billing, execution, auth-lambda, infra-db e infra-k8s.

| Tema | Padrão do modelo | Uso no hackathon |
|---|---|---|
| Stack | NestJS 11, Node 22, Prisma, yarn | Reuso |
| Camadas | Hexagonal pragmático (ADR-003) + dependency-cruiser (`yarn arch:check`) | Reuso |
| Mensageria | SQS para comandos com DLQ, SNS para eventos, fan-in numa fila; envelope em `packages/domain-shared/src/messaging.ts` | Reuso, com filas novas |
| Saga/outbox | Tabelas outbox e inbox no Prisma; despacho inline, **sem relay em background** | Corrigir: relay em background |
| Idempotência | Inbox por `eventId`, conditional put e marcadores com TTL | Reuso |
| Auth | Lambda CPF com RS256 + JWT authorizer no API Gateway; serviços **confiam nos headers** do gateway | Auth próprio com usuário e senha, e revalidação do JWT nos serviços |
| Banco | MySQL (RDS) + DynamoDB | Trocar por PostgreSQL + Redis |
| Testes | Jest com cobertura de 90%, Cucumber pt-BR, supertest, compose de e2e | Reuso (gate em 80%) |
| Sonar | SonarCloud org dinhogt, `qualitygate.wait=true` | Reuso |
| CI/CD | GitHub Actions: security-gate, lint, test, Sonar → OIDC → ECR → EKS com `rollout undo` | Reuso |
| Infra | Terraform: VPC com 1 NAT, RDS t3.micro, EKS t3.medium, API GW HTTP + VPC Link + NLB, SQS/SNS, IRSA, state no S3 com lock | Reuso e adaptação |
| Observabilidade | CloudWatch EMF + X-Ray + logs JSON com correlationId e redaction | Trocar por Prometheus/Grafana/OTel; manter logs JSON |
| Docker | Multi-stage, non-root uid 10001 | Reuso, com ffmpeg no worker |
| Docs | ADRs `adr-NNN-*.md` (Contexto/Decisão/Alternativas/Consequências), Mermaid, `docs/delivery/artifacts-fase4.md`, `_local-entrega/` com roteiro de vídeo | Reuso |

Arquivos-chave do modelo:
- `autoservicemanager-app/docs/architecture/` (ADRs 002–018, diagramas)
- `autoservicemanager-app/docs/delivery/artifacts-fase4.md`
- `autoservicemanager-app/scripts/security-gate.sh`
- `autoservicemanager-app/docker-compose.phase4.yml`
- `autoservicemanager-infra-k8s/{messaging,apigw,irsa,observability}.tf`
- `_local-entrega/fase4/video-script-fase4.md`

## 3. spec-skills-lib (`hackaton/spec-skills-lib/`)
- **Perfil:** o projeto é multi-service, usa IaC e é orientado a eventos, o que dá `complexity_profile: high` e `complex-flow`. Por isso exige `docs/requirements/wbs.md` e `epics.md`.
- **Override a aplicar:**
  - `active_flow: complex-flow`, `complexity_profile: high`;
  - `implementation_level: mvp`, que implica ASVS L1 e cobertura de 80%;
  - `stack_profile: nestjs-next-react`;
  - `cloud_preference: aws` (exige ADR, porque a lib prefere OCI).
- **Gates do complex-flow:**
  - requirements: critérios de aceite e rastreabilidade;
  - architecture: ADRs e fronteiras explícitas;
  - cloud: avaliação de opções;
  - security: threat model, ASVS e nenhum segredo;
  - finops: plano de custo;
  - infrastructure: CI/CD e rollback;
  - backend: testes e caminhos de erro;
  - documentation: runbook e release notes;
  - observability: dashboards, alertas e traces;
  - qa: go/no-go.
- **Docs exigidas:**
  - `docs/requirements/*`, `docs/architecture/solution-design.md` + ADRs
  - `docs/security/{threat-model,controls-matrix}.md`, `docs/cloud/*`, `docs/finops/*`
  - `docs/infrastructure/{ci-cd,environments}.md`, `docs/backend/{api-contract,test-report}.md`
  - `docs/observability/{dashboards,alerts,tracing}.md`, `docs/qa/{validation-report,regression-report}.md`
  - `docs/runbook.md`, `docs/release-notes.md`, `docs/support/*`
- **ADRs:** incluir a seção Governance (6 perguntas + tier de escala). EKS diverge da referência `aws-scale-up.md`, que prefere Fargate abaixo de 10 mil usuários, e por isso precisa de justificativa.
