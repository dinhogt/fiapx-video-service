# Playbook de execução: FIAP X Video Processor

**Como usar:**
- Execute as fases em ordem. Dentro de uma fase, siga a ordem dos IDs, exceto quando a coluna "Dep." indicar outra dependência.
- Cada tarefa referencia a **fonte da verdade** (Ref.). Não invente: se faltar algo, aplique a regra 3 do `AGENTS.md`.
- Tarefas marcadas com 🛑 exigem **aprovação humana** antes de executar.
- A verificação é o critério de pronto. Registre a evidência em `docs/historico.md`.

Abreviações:

| Sigla | Significado |
|---|---|
| `spec` | `docs/05-especificacao-tecnica.md` |
| `rev` | `docs/06-revisao-critica.md` |
| `tpl` | `docs/execucao/templates/` |
| `VS` | `fiapx-video-service` |
| `AS` | `fiapx-auth-service` |
| `WK` | `fiapx-video-worker` |
| `NS` | `fiapx-notification-service` |
| `IN` | `fiapx-infra` |

---

## F0: Preparação (semana 1, dia 1)
| ID | Tarefa | Ref. | Verificação |
|---|---|---|---|
| F0.1 | Conferir as versões das ferramentas do AGENTS.md §4 | AGENTS | `node -v` (22.x), `yarn -v` (4.x), `docker compose version`, `terraform -v`, `k6 version`, `gitleaks version` |
| F0.2 🛑 | Criar os 5 repos **públicos** em `dinhogt` com `develop` como default, mais `master`. Clonar em `hackaton/fiapx-repos/` | D10, D11, D23 | `gh repo list dinhogt \| grep fiapx-` lista 5 |
| F0.3 🛑 | Criar os projetos no SonarCloud (org dinhogt) e o `SONAR_TOKEN` em cada repo de serviço | B15 | `gh secret list -R dinhogt/fiapx-video-service` contém SONAR_TOKEN |
| F0.4 | Gerar as fixtures `test/fixtures/sample-5s.mp4` (testsrc ffmpeg, 320×240, cerca de 300 KB, para testes), `sample-30s.mp4` (720p, para a demo) e `corrupted.mp4` (bytes aleatórios) | B12 | `ffprobe sample-5s.mp4` mostra 5 s; `ffprobe corrupted.mp4` falha |

## F1: Fundação (semana 1)
| ID | Repo | Tarefa | Ref. | Dep. | Verificação |
|---|---|---|---|---|---|
| F1.1 | todos os de serviço | Scaffold NestJS 11 + TS strict + yarn 4, com a estrutura de pastas B9. Copiar de `tpl`: `.gitignore`, `.editorconfig`, `eslint.config.mjs`, `.prettierrc`, `.dependency-cruiser.cjs`, `jest.config.ts`, `Dockerfile`, `pull_request_template.md`, `sonar-project.properties`, `scripts/security-gate.sh`, `.github/workflows/ci.yml` | B9, B16, tpl | F0.2 | `yarn lint && yarn depcruise && yarn test && docker build .` verdes |
| F1.2 | todos os de serviço | Módulos transversais: config com zod (fail-fast), logger pino com redaction, `/health/live`, `/health/ready`, `/metrics`, OTel SDK, filtro de erros RFC 7807, middleware de `X-Correlation-Id`, `helmet` | B1, B9, ADR-011 | F1.1 | Teste unitário do redaction; `curl /health/live` = 200; boot com env inválido sai com código ≠ 0 |
| F1.3 | VS | Pacote `packages/contracts`: envelope v1 e 5 mensagens em zod, enum `failureCode`, nomes de filas e tópicos por env, função `buildEnvelope()` | B2, B11 | F1.1 | `yarn workspace @dinhogt/fiapx-contracts test` (parse válido e inválido) |
| F1.4 🛑 | VS | Publicar `@dinhogt/fiapx-contracts@1.0.0` no GitHub Packages (tag `contracts-v1.0.0`) e dar acesso de leitura aos 3 outros repos | B11 | F1.3 | `npm view @dinhogt/fiapx-contracts --registry=https://npm.pkg.github.com` |
| F1.5 | VS | `docker-compose.yml` + `localstack/init/ready.d/10-resources.sh` (filas, DLQs, tópicos, inscrições com filtro, bucket com lifecycle) + `observability/` (alloy, prometheus, loki, tempo, grafana provisionado) + `Makefile` (`up`, `down`, `e2e`, `logs`) | B8, B12, ADR-010/011 | F1.1 | `make up` deixa todos os containers de infra `healthy`; `awslocal sqs list-queues` lista 8 filas |
| F1.6 | IN | `db/init.sql` com variáveis psql (S-06): `citext`, 3 schemas, 3 roles, grants mínimos. Montado no Postgres do compose | B4, S-06 | F1.5 | `psql -U auth_svc -c "select * from video.videos"` → **permission denied** |
| F1.7 | VS | Copiar `docs/` do hackathon para `VS/docs/` (canônico) e o override da lib para `VS/spec-skills-lib/rules/global-rules.override.yaml` | AC-01 | F1.1 | `bash spec-skills-lib/tools/validate-local.sh` OK |

## F2: auth-service (semana 1–2)
| ID | Tarefa | Ref. | Verificação |
|---|---|---|---|
| F2.1 | Schema Prisma `auth` (`users`, `sessions`, `refresh_tokens`, `outbox`), migração inicial, Job de migrate no compose | B4 | `yarn prisma migrate deploy` contra o compose |
| F2.2 | Domínio: `Email`, `Password` (12–128, lista das 10 mil mais comuns), `Session` (idle de 60 min, absoluto de 8 h, revogação), `RefreshToken` (rotação, reuso) | ADR-006 | Unit tests ≥ 90% no domínio |
| F2.3 | `POST /auth/register` com argon2id e outbox `user.registered` na mesma transação | B1, D32 | AC-10, AC-11 (integration) |
| F2.4 | Chave RS256 (env PEM + `kid`), `/.well-known/openid-configuration`, `/.well-known/jwks.json` | D30 | JWKS válido (teste com `jose.createRemoteJWKSet`) |
| F2.5 | `POST /auth/login`: rate limit Redis fail-closed (IP via `x-client-ip` se `TRUST_GATEWAY_IP`), par de tokens | B1, B6, S-01 | AC-12 (6ª tentativa → 429); Redis parado → 503 |
| F2.6 | `POST /auth/refresh`: rotação, detecção de reuso que revoga o `sid` e grava `revoked:sid` | ADR-006 | AC-14, AC-15, AC-16 |
| F2.7 | `POST /auth/logout`, `GET /auth/me`, guard global de JWT com `@Public()` | B1, V4.2 | AC-17; teste que varre as rotas e confirma que só as públicas listadas dispensam token |
| F2.8 | Outbox relay (1 s, SKIP LOCKED) e reidratação da revogação (boot + 60 s), com advisory lock nos jobs | B6, E-05 | Integration: `user.registered` chega à fila `user-contacts` do LocalStack |
| F2.9 | Biblioteca de guard JWT reutilizável (JWKS em cache de 10 min + checagem de revogação no Redis + 503 fail-closed), copiada para o VS | B1 | AC-13 |
| F2.10 | Cobertura ≥ 80%, OpenAPI exportado em `docs/api/openapi-auth.json`, README | B15 | CI do PR verde |

## F3: video-service (semana 2)
| ID | Tarefa | Ref. | Verificação |
|---|---|---|---|
| F3.1 | Schema Prisma `video` (`videos`, `outbox`, `inbox`), migração | B4 | `migrate deploy` |
| F3.2 | Domínio: `Video` com a máquina de estados D26 (transições monotônicas), `Fps`, `VideoFile` (extensão ↔ content-type) | RF-14, B1 | Unit: todas as transições válidas e inválidas |
| F3.3 | `POST /videos` com presigned POST (`content-length-range`, `Content-Type`, chave do servidor, `S3_PUBLIC_ENDPOINT`) | D25, B7 | AC-20; upload de 501 MB **rejeitado pelo S3** |
| F3.4 | `POST /videos/{id}/confirm`: HEAD no S3, depois transação QUEUED + outbox; idempotente | ADR-004/005 | AC-21, AC-22, AC-23 |
| F3.5 | Outbox relay, para a fila `video-process` | B6 | AC-71 (relay parado e depois reiniciado publica os pendentes) |
| F3.6 | `GET /videos` (cursor, cache por versão, fail-open) e `GET /videos/{id}` (404 para não-dono) | B1, B6 | AC-40, AC-80 |
| F3.7 | `GET /videos/{id}/download` (5 min, `Content-Disposition` sanitizado, 409 e 410) | S-02, E-03 | AC-50, AC-51; teste unitário com nome `a"\r\nX: y.mp4` |
| F3.8 | Consumidor de `video-status-updates`: inbox + transição monotônica + `INCR videos:ver` | B2 | Evento fora de ordem é ignorado (unit + integration) |
| F3.9 | Jobs: expiração de 24 h (RF-15) e housekeeping (E-04), com advisory lock | B3, E-04/05 | Integration com relógio controlado |
| F3.10 | Métricas de negócio (`videos_uploaded_total`, `outbox_*`) e propagação de `traceparent` | ADR-011 | `/metrics` expõe as séries |
| F3.11 | Cobertura ≥ 80%, OpenAPI `docs/api/openapi-video.json`, README | B15 | CI verde |

## F4: video-worker (semana 2)
| ID | Tarefa | Ref. | Verificação |
|---|---|---|---|
| F4.1 | Consumidor SQS com 1 loop (D34), heartbeat de VT a cada 60 s, graceful shutdown | B5, D34 | Unit com SQS mockado |
| F4.2 | Builder de argumentos ffprobe/ffmpeg (array, sem shell) e executor com timeout e SIGKILL | ADR-014 | Unit: os argumentos não contêm o `fileName`; o timeout mata o processo |
| F4.3 | Validação ffprobe + `MAX_FRAMES` | D28 | `corrupted.mp4` → `INVALID_VIDEO`; vídeo longo → `VIDEO_TOO_LONG` |
| F4.4 | Extração em janelas de 60 s → zip em streaming (archiver store) → multipart no S3, apagando os PNGs | D27 | Integration: `sample-5s.mp4` a 1 fps gera zip com 5 PNGs; pico de `/work` < 50 MB |
| F4.5 | Idempotência: zip existente → republica `processed` | ADR-004 | AC-31 |
| F4.6 | Classificação de erros permanentes e transitórios + `video.failed` na 3ª tentativa | B3 | AC-32 e testes por `failureCode` |
| F4.7 | Exporter de profundidade da fila e da DLQ + métricas de duração e frames | ADR-011 | `/metrics` |
| F4.8 | Dockerfile do worker (bookworm + ffmpeg, non-root, rootfs read-only, `/work` emptyDir), CI com ffmpeg (E-06) | tpl, E-06 | Trivy sem HIGH/CRITICAL corrigível |

## F5: notification-service (semana 2)
| ID | Tarefa | Ref. | Verificação |
|---|---|---|---|
| F5.1 | Schema `notification` (`user_contacts`, `inbox`, `notifications`) | B4 | `migrate deploy` |
| F5.2 | Consumidor de `user-contacts` (upsert) | D18 | Integration |
| F5.3 | Consumidor de `notifications`: inbox → contato (ausente → erro e retry) → `EmailSender` → registro | ADR-012 | AC-60, AC-61 (e-mail único no Mailpit) |
| F5.4 | Adapters SES e SMTP; template pt-BR com `fileName` escapado | ADR-012, T-13 | Unit do template |
| F5.5 | Cobertura ≥ 80%, README | B15 | CI verde |

## F6: Integração local (fim da semana 2, marco M2)
| ID | Tarefa | Ref. | Verificação |
|---|---|---|---|
| F6.1 | BDD em `VS/features/processamento-video.feature` (pt-BR) cobrindo AC-10..18, 20..23, 30, 40, 50, 51, 60, 80 | AC | `make e2e` verde |
| F6.2 | Workflow `VS/.github/workflows/e2e.yml` (checkout dos irmãos) | E-01 | Execução verde no GitHub |
| F6.3 | Postman em `VS/docs/postman/`: collection com scripts (login → token, refresh automático, presigned POST form-data, polling) + envs `local` e `homolog` | D08 | Execução no Newman verde contra o ambiente local |
| F6.4 | k6 `VS/test/load/peak.js`: 50 usuários, upload + confirm simultâneos, polling até o status final | AC-70 | 100% dos vídeos em COMPLETED/FAILED e 0 em QUEUED depois da drenagem (relatório em `docs/qa/`) |
| F6.5 | Revisão de segurança local: rodar a checklist de `controls-matrix.md` e marcar as evidências | security | Todos os controles com evidência |

## F7: Infra AWS (semana 3)
| ID | Tarefa | Ref. | Verificação |
|---|---|---|---|
| F7.1 | `IN/scripts/bootstrap-state.sh` (bucket de state + lock) e roles OIDC por repo (Terraform `bootstrap/`) | B8, ADR-013 | `terraform init` com backend OK |
| F7.2 | Root `data/`: VPC (2 AZ, 1 NAT), RDS PG16 (`force_ssl`, Secrets Manager nativo), ElastiCache Valkey Multi-AZ (TLS + AUTH), S3 (lifecycle, SSE, policy SecureTransport), Budget de 50 USD, secrets dos serviços | ADR-007/008, D22, S-04 | `terraform plan` sem erro; checkov sem falha HIGH |
| F7.3 | Root `platform/`: EKS (KMS, S-03; pools `apps` e `worker` spot com taint, D34), SG de NodePort (S-05), add-ons (metrics-server, Cluster Autoscaler, KEDA, kube-prometheus-stack, loki, tempo, alloy via helm), SQS/SNS (B8), API Gateway + VPC Link + NLB instance (D29) + parameter mapping `x-client-ip` (S-01), IRSA por serviço (B14), ECR | ADR-009/011, B13 | `terraform plan` sem erro |
| F7.4 | Workflows da infra: `plan` em PR, `apply` (environment homolog), `destroy` (manual com confirmação), `db-init` (E-02) | B15, E-02 | PR mostra o plan comentado |
| F7.5 🛑 | **Primeiro apply** de data → platform → db-init | finops | `kubectl get nodes` (2 apps + 1 worker); `psql` via Job confirma 3 schemas |
| F7.6 🛑 | Verificar o remetente e o destinatário da demo no SES | ADR-012 | `aws sesv2 get-email-identity` = SUCCESS |

## F8: CD e homolog (semana 3, marco M3)
| ID | Tarefa | Ref. | Verificação |
|---|---|---|---|
| F8.1 | Manifests `k8s/` por serviço (copiar de `tpl/k8s/`): Deployment, Service NodePort (auth, video), HPA ou ScaledObject (worker), PDB, ServiceAccount IRSA, Job de migrate | ADR-009, D34 | `kubectl apply --dry-run=server` |
| F8.2 | Job de CD em `ci.yml` (push em develop): ECR → secret do Secrets Manager → migrate → apply → rollout → undo → smoke | B15 | Deploy verde; rollout com imagem quebrada executa undo (AC-101) |
| F8.3 | Configurar o issuer = URL do gateway no ConfigMap (output do Terraform) | D30 | Chamada via gateway com token = 200; sem token = 401 no gateway |
| F8.4 | Smoke e Postman `homolog` completos + k6 em homolog com KEDA e CA escalando | AC-70 | Grafana mostra workers > 1 e nós `worker` > 1 |
| F8.5 | Release: PR develop → master 🛑, tag `v1.0.0` nas imagens e GitHub Release | D20 | Release publicado nos 4 repos |

## F9: Observabilidade (semana 3)
| ID | Tarefa | Ref. | Verificação |
|---|---|---|---|
| F9.1 | Dashboard "FIAP X: jornada do vídeo" (JSON provisionado): uploads, status, duração p50/p95, fila e DLQ, réplicas do worker, erros por serviço, latência HTTP | ADR-011 | Captura de tela em `docs/observability/` |
| F9.2 | Regras de alerta (ADR-011 + P-02, P-03) + `docs/observability/alerts.md` + um runbook por alerta em `docs/runbook.md` | observability | `promtool check rules` |
| F9.3 | Trace ponta a ponta: API → SQS → worker → SNS → notification no Tempo, com o salto log → trace | AC-90 | Captura do trace em `docs/observability/tracing.md` |

## F10: Entrega (semana 3, marco M4)
| ID | Tarefa | Ref. | Verificação |
|---|---|---|---|
| F10.1 | Atualizar `VS/docs` com evidências: `qa/validation-report.md` (AC → evidência, go/no-go), cobertura dos 4 repos, relatório do k6, `infrastructure/ci-cd.md` e `environments.md` (rollback documentado), `backend/api-contract.md` (links para o OpenAPI), `support/incident-playbook.md`, `release-notes.md`, `runbook.md` | lib docs | Todos os links resolvem |
| F10.2 | Exportar os diagramas Mermaid para PNG em `docs/delivery/assets/` | diagrams | Arquivos presentes |
| F10.3 | Preencher `docs/delivery/artifacts.md` (checklist PDF → evidência) | artifacts | 100% marcado |
| F10.4 🛑 | Gravar o vídeo seguindo `docs/delivery/video-script.md` (≤ 10 min) | video-script | Duração ≤ 10:00 |
| F10.5 🛑 | `destroy` da homolog (D22) e conferência do custo final | finops | Custo no Cost Explorer ≤ 50 USD |
