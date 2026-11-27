# Hackathon FIAP X: plano de arquitetura e de entrega

## Contexto
- **Ponto de partida.** O projeto base ([projeto-fiapx/main.go](../projeto-fiapx/main.go)) é um monolito Go/Gin.
  - Processa o vídeo de forma síncrona, dentro do próprio request: `ffmpeg -vf fps=1`, depois gera o zip.
  - Guarda os arquivos em disco local, não tem autenticação, banco nem testes.
  - O CORS aceita `*`, o download tem path traversal e o Dockerfile roda `go run` como root.
- **O que o enunciado pede:**
  - processar vários vídeos ao mesmo tempo, sem perder requisições em picos;
  - autenticação por usuário e senha;
  - listagem de status por usuário e notificação em caso de erro;
  - persistência, escalabilidade, testes, CI/CD e GitHub;
  - documentação de arquitetura, script de criação do banco e vídeo de até 10 minutos.
- **Referências:**
  - Padrões técnicos: `autoservicemanager-repos` (NestJS, SQS/SNS, EKS, Terraform, OIDC, Sonar, cobertura de 90%, ADRs).
  - Governança: `hackaton/spec-skills-lib`. Pelo `complexity-profile`, o projeto é `complex-flow`/`high`: multi-service, IaC e orientado a eventos.

### Decisões já tomadas com você
| Tema | Decisão |
|---|---|
| Stack | NestJS 11 / TypeScript / Node 22, a mesma do modelo e o stack oficial da lib |
| Ambiente | Híbrido: demo completa em ambiente local (Docker Compose + LocalStack) e AWS EKS via Terraform/CI |
| Conta AWS | Pessoal, o que permite reaproveitar IAM, OIDC e IRSA do modelo |
| Repositórios | Multi-repo, como no modelo |
| Observabilidade | Prometheus + Grafana + OpenTelemetry |
| Upload | URL pré-assinada do S3 |
| Escopo | Uma pessoa, 2 a 3 semanas |

---

## 1. Arquitetura proposta

```
Cliente (Postman / página web simples)
   │ HTTPS
API Gateway HTTP API (JWT authorizer RS256 + throttling)
   │ VPC Link → NLB
   ├── auth-service   (/auth/register, /auth/login, /.well-known/jwks.json)  → Postgres schema auth
   └── video-service  (/videos …)  → Postgres schema video + Redis (cache/rate-limit)
          │ outbox → SQS video-process-commands (+DLQ)
          ▼
      video-worker (N pods × concorrência C, KEDA por profundidade da fila)
          │ S3 raw/ → ffmpeg → zip → S3 output/
          ▼
      SNS video-events ─┬─► SQS video-status-updates → video-service (atualiza status)
                        └─► SQS notifications → notification-service → SES (local: Mailpit)
```

### Ciclo de vida do vídeo
`PENDING_UPLOAD → QUEUED → PROCESSING → COMPLETED | FAILED` (+ `EXPIRED`; T02)

O detalhamento técnico completo está em [05-especificacao-tecnica.md](05-especificacao-tecnica.md).

As transições são validadas em uma state machine de domínio, no mesmo padrão de `saga-state-machine.ts` do modelo.

### Fluxo principal
1. `POST /videos` cria o registro e devolve uma URL pré-assinada de PUT.
   - A URL vale 15 minutos e tem limites de tamanho e de content-type.
2. O cliente envia o arquivo direto para o S3.
3. `POST /videos/:id/confirm` valida que o objeto existe (HEAD) e faz duas coisas na mesma transação:
   - muda o status para QUEUED;
   - grava a mensagem na outbox.
4. Um relay da outbox publica a mensagem no SQS. Isso corrige um ponto fraco do modelo, onde a outbox não tinha relay em background.
5. O worker consome a mensagem:
   - estende o visibility timeout periodicamente enquanto processa vídeos longos;
   - roda ffprobe/ffmpeg com timeout;
   - gera o zip em streaming para o S3;
   - publica `video.processed` ou `video.failed`.
6. `GET /videos` lista os vídeos do usuário.
   - Lê do Redis (TTL curto) e invalida o cache quando um evento chega.
7. `GET /videos/:id/download` devolve uma URL pré-assinada de GET. Só o dono do vídeo consegue.
8. Em caso de falha: após N tentativas a mensagem vai para a DLQ, o status vira FAILED e o usuário recebe um e-mail.

---

## 2. Decisões de arquitetura (cada uma vira um ADR)

> **Atualização da Entrega 1:** foram escritos **15 ADRs** em [architecture/](architecture/). Entraram o ADR-014 (pipeline do worker) e o ADR-015 (AWS). A tabela abaixo é a proposta original.

Os ADRs seguem o formato do modelo: tabela de metadados, depois Contexto / Decisão / Alternativas / Consequências. Cada um inclui a seção Governance exigida pela lib, com as 6 perguntas e o tier de escala.

| ADR | Decisão | Por que (trade-off) |
|---|---|---|
| 001 | Microsserviços: auth, video, worker e notification | Separar o worker (CPU-bound) da API (IO-bound) é o ganho real de escala. Mais serviços que isso seria cerimônia para um projeto solo. |
| 002 | NestJS e hexagonal pragmático (domain / application / infrastructure / interfaces), com dependency-cruiser | Reuso direto do ADR-003 do modelo e de `.dependency-cruiser.cjs` |
| 003 | Comandos via SQS e eventos via SNS → SQS, com DLQ e `maxReceiveCount` 3 | Durabilidade em picos: o pico vira backlog na fila e não vira erro. Reuso de `messaging.tf` do modelo. |
| 004 | Outbox transacional com relay em background, inbox de idempotência por `messageId` e worker idempotente por `videoId` | Atende "não perder requisição" e cobre a entrega at-least-once |
| 005 | Upload e download por URL pré-assinada, bucket privado com SSE e lifecycle (raw 1 dia, zip 7 dias) | A API não carrega bytes de vídeo. Custo de armazenamento sob controle. |
| 006 | Auth próprio: argon2id, JWT RS256 com 15 minutos de validade, JWKS, autorizador do API Gateway e revalidação do JWT nos serviços (defesa em profundidade) | Atende "usuário e senha" sem Cognito, que não roda localmente. Corrige o ponto do modelo que confiava só nos headers do gateway. |
| 007 | PostgreSQL (RDS) com um schema por serviço, migrações com Prisma e script SQL de criação | O enunciado recomenda Postgres. Isso substitui o MySQL do modelo. |
| 008 | Redis gerenciado: ElastiCache for Valkey, primário + réplica Multi-AZ (D24). Usado para cache da listagem (fail-open), rate limit (fail-closed) e camada rápida de revogação (fail-closed, reidratada do Postgres). | Robusto e persistente. A segurança não depende de dado volátil. |
| 009 | EKS + HPA (API) + KEDA (worker, escala pela profundidade da fila) | Reuso do Terraform do modelo. Registrar que a lib prefere Fargate e justificar a escolha. |
| 010 | LocalStack (S3, SQS, SNS) no ambiente local, mesmo SDK da AWS | Evita adapters duplos (RabbitMQ/MinIO). As portas hexagonais continuam existindo para os testes. |
| 011 | Prometheus + Grafana + OTel Collector → Tempo (traces) + Loki (logs) (D21), com `traceparent` no envelope da mensagem e logs JSON com `correlationId` e `trace_id` | Funciona igual local e no EKS (kube-prometheus-stack) |
| 012 | Notificação como serviço consumidor, com porta de e-mail (SES na AWS, Mailpit local) e réplica `userId → email` via `user.registered` (D18) | Desacoplada via fan-out. Extensível para outros canais. |
| 013 | Multi-repo, GitHub OIDC e CI/CD por repositório | Mesmo padrão do modelo (ADR-009) |

---

## 3. Repositórios (GitHub, multi-repo)

| Repo | Conteúdo | Reuso do modelo |
|---|---|---|
| `fiapx-video-service` | API de vídeos, outbox/relay, consumer de status, pacote `@<org>/fiapx-contracts` (envelope + eventos), **docs canônicas**, `docker-compose.yml` completo, BDD | Estrutura do `autoservicemanager-app`, `packages/domain-shared/src/messaging.ts`, `json-logger`, `log-redact`, `request-context` |
| `fiapx-video-worker` | Consumer SQS, pipeline ffmpeg/zip em streaming, publisher SNS | Estrutura do `autoservicemanager-execution`, `k8s/execution.yaml` (Deployment, HPA, PDB) |
| `fiapx-auth-service` | Cadastro e login, emissão RS256, JWKS, rate limit | Lógica JWT de `autoservicemanager-auth-lambda/src/jwt.ts` |
| `fiapx-notification-service` | Consumer de `notifications` e envio por SES ou Mailpit | `notify-os/handler.ts` como referência |
| `fiapx-infra` | Terraform com 2 root modules: `data` (VPC, RDS Postgres, ElastiCache Valkey Multi-AZ, S3, Budgets) e `platform` (EKS, API Gateway, NLB, SQS/SNS, IRSA, KEDA, Prometheus/Grafana/Loki/Tempo via Helm; só homolog, D20) | `infra-db` + `infra-k8s` + `bootstrap-state.sh` |

O modelo separa infra-db e infra-k8s em dois repos. Para uma pessoa, a proposta é um único repo de infra com dois states, registrado no ADR-013. Se preferir manter os dois repos, a mudança é trivial.

---

## 4. Segurança (ASVS L1 com `implementation_level: mvp`, mais alguns controles L2)
- Senha com argon2id. Login com rate limit no Redis e respostas genéricas, sem enumeração de usuário.
- Toda query é filtrada por `userId` vindo do JWT, contra IDOR.
- Upload:
  - whitelist de extensão e content-type na URL pré-assinada, com tamanho máximo (ex.: 500 MB);
  - `ffprobe` no worker antes de processar.
- O ffmpeg recebe argumentos em array, nunca uma string de shell, e roda com timeout e com limites de CPU e memória no pod.
- S3 privado, com SSE e `BlockPublicAccess`.
- Segredos só no Secrets Manager ou em K8s Secrets. O `security-gate.sh` do modelo bloqueia `.env`, tfstate e chaves no repo.
- Containers multi-stage, non-root (uid 10001) e com filesystem read-only. Trivy roda no CI.
- Threat model STRIDE-lite em `docs/security/threat-model.md` e `controls-matrix.md`.

## 5. Qualidade e testes
- Jest com teste unitário ao lado do código. Gate de **cobertura de 80%** no Sonar (o modelo usa 90%; podemos mirar 90 com 80 como gate).
- Integração com Testcontainers (Postgres, Redis, LocalStack): repositórios, outbox e consumer.
- BDD com Cucumber em pt-BR, `features/processamento-video.feature`, cobrindo:
  - upload → COMPLETED → download;
  - vídeo inválido → FAILED → e-mail;
  - usuário B não acessa o vídeo do usuário A.
- Teste de carga com k6: enviar 50 vídeos de uma vez e provar que todos terminam em COMPLETED, sem perdas, enquanto o worker escala.
- Testes do worker com vídeo pequeno de fixture (ex.: 3 segundos) e ffmpeg real dentro do container de CI.

## 6. CI/CD (GitHub Actions por repo, padrão do modelo)
- **PR:** security-gate, lint, `test:cov`, build, Sonar (quality gate), `npm audit` e Trivy.
- **Push em `develop` ou `main`:**
  - build e push para o ECR via OIDC;
  - deploy no EKS com `kubectl apply`, rollout status e `rollout undo` em caso de falha.
- **Infra:**
  - PR: `fmt`, `validate` e `plan`.
  - Merge: `apply`, com a flag `ENABLE_OIDC_CD` do modelo.
- Branch protection documentada, como em `docs/infrastructure/branch-protection.md` do modelo.

## 7. Observabilidade
- Métricas:
  - `videos_uploaded_total`, `videos_processed_total{status}`, `video_processing_duration_seconds`;
  - profundidade da fila e da DLQ (exporter);
  - HTTP RED por serviço.
- Dashboard Grafana provisionado em JSON com:
  - jornada upload → completed;
  - fila e escala do worker;
  - erros.
- Alertas, cada um com runbook: mensagens na DLQ acima de 0, taxa de falha acima de 10%, idade da mensagem mais antiga, p95 da API.

## 8. Documentação (docs canônicas em `fiapx-video-service/docs`, caminhos da lib)
- `docs/requirements/` (requirements, acceptance-criteria, epics, wbs)
- `docs/architecture/` (solution-design, diagramas Mermaid C4 de contexto, container e sequência, ADRs `adr-NNN-*.md`)
- `docs/security/`, `docs/cloud/`, `docs/finops/` (custo estimado e plano de desligamento)
- `docs/infrastructure/` (ci-cd, environments, rollback)
- `docs/observability/`, `docs/qa/` (cobertura, k6, go/no-go), `docs/runbook.md`, `docs/release-notes.md`
- `docs/delivery/artifacts.md`: checklist que mapeia cada requisito do PDF para arquivo ou comando, como `artifacts-fase4.md` do modelo
- Script de banco em `db/init.sql` (schemas, usuários com privilégio mínimo por serviço) e migrações Prisma
- Postman collection com ambientes local e AWS
- `spec-skills-lib/rules/global-rules.override.yaml` com:
  - `active_flow: complex-flow`, `complexity_profile: high`;
  - `implementation_level: mvp`, `stack_profile: nestjs-next-react`;
  - `cloud_preference: aws` (com ADR, porque a lib prefere OCI).

---

## 9. Roadmap (cerca de 3 semanas, solo)

| Semana | Entregas |
|---|---|
| 1, fundação | Docs upstream (requirements, ADRs 001–013, diagramas, threat model). Repos criados com skeleton NestJS, lint, Jest, Dockerfile e CI básico. Pacote de contratos. `docker-compose` com Postgres, Redis, LocalStack, Mailpit, Prometheus e Grafana. auth-service completo. |
| 2, núcleo | video-service (presigned, confirm, outbox/relay, listagem com cache, download, consumer de status). video-worker (ffmpeg, zip em streaming, idempotência, heartbeat, DLQ). notification-service. BDD ponta a ponta local. Cobertura acima de 80%. |
| 3, cloud e entrega | `fiapx-infra` (Terraform data e platform), CD via OIDC, KEDA, kube-prometheus-stack. k6 em homolog. Dashboards e alertas. `artifacts.md`, roteiro do vídeo e gravação. Destroy da infra após a avaliação. |

**Corte de escopo** se o tempo apertar, nesta ordem: página web → KEDA (fica só o HPA por CPU) → Redis cache (fica só o rate limit) → deploy AWS completo (fica a demo local mais o `terraform plan` no CI).

## 10. Verificação ponta a ponta
1. `docker compose up` no video-service sobe toda a stack local. Depois roda `npm run test:e2e` (Cucumber).
2. Na Postman collection: register → login → create → PUT no S3 → confirm → poll em `GET /videos` → download do zip. Abrir o zip e conferir os frames.
3. Enviar um arquivo corrompido: o status vira FAILED e o e-mail aparece no Mailpit.
4. Rodar o k6 com 50 uploads simultâneos: zero perdas, fila drenada e worker escalado, tudo visível no Grafana.
5. Em cada repo, o CI fica verde, o quality gate do Sonar passa e a cobertura fica em 80% ou mais.
6. Na AWS (homolog): `terraform apply`, CD verde e o mesmo roteiro Postman pelo API Gateway.

## Pontos fechados depois da aprovação
- Front: **só Postman**. A collection usa scripts que encadeiam o token, a URL pré-assinada e o polling. Sem página web.
- FPS: **parâmetro opcional**, padrão 1, limitado a 0.1–5 e validado na API e no worker.
- GitHub: conta **dinhogt**, repos `fiapx-*`, branches **master/develop** (develop vai para homolog e master para produção).
- Pastas locais: `hackaton/fiapx-repos/<repo>`. O `projeto-fiapx` fica intocado como referência.
