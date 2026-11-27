# Histórico do projeto

## 2026-11-19: Sessão 1 (planejamento)
- **Leitura do enunciado** (PDF da Fase 5). Resumo em [00-enunciado.md](00-enunciado.md).
- **Análise das referências** (detalhes em [03-referencias.md](03-referencias.md)):
  - o projeto base `projeto-fiapx`;
  - o projeto modelo `autoservicemanager-repos`;
  - a `spec-skills-lib`.
- **Duas rodadas de perguntas e respostas** fecharam as decisões D01 a D11 ([02-decisoes.md](02-decisoes.md)).
- **Plano de arquitetura aprovado**: [01-plano-arquitetura.md](01-plano-arquitetura.md).
- **Criada a pasta `hackaton/docs/`** para centralizar os documentos e o histórico (D12).
- **Próximo passo sugerido**, na semana 1: escrever no `fiapx-video-service`:
  - requisitos, critérios de aceite, épicos e WBS;
  - os 13 ADRs, um a um, para discussão;
  - os diagramas;
  - o threat model;
  - o ajuste do `global-rules.override.yaml`.

## 2026-11-20: Sessão 2 (Entrega 0: requisitos)
- **Criados os documentos da Entrega 0** em `docs/requirements/`, no formato do projeto modelo:
  - `requirements.md`: 10 fluxos (F1–F10), RF-01..15 e RNF-01..13, com rastreabilidade ao enunciado;
  - `acceptance-criteria.md`: critérios Dado/Quando/Então das Entregas 0, 1 e de implementação;
  - `epics.md`: EP-01..06, Definition of Ready e Definition of Done;
  - `wbs.md`: 11 pacotes, marcos M0–M4 e plano de corte.
- **Confirmados os parâmetros D13–D16** (upload, worker, e-mail, sessão).
- A política de sessão ganhou controles de segurança: refresh rotativo, detecção de reuso, limite absoluto de 8 h e revogação por `sid`. Foram acrescentados RF-02a/b e AC-14..17.
- ~~Pendência: reavaliar o access de 60 min~~ → resolvida pela **D17**.
- **D17: access token revisado para 15 min** para garantir a integridade da sessão. Refresh deslizante de 60 min, limite de 8 h e revogação por `sid` mantidos. RF-02 atualizado e AC-18 acrescentado.
- **Próximo passo:** Entrega 1, com o `global-rules.override.yaml` e os ADRs 001–013 discutidos um a um, a começar pelo ADR-001 (decomposição em serviços).
- **Análise de lacunas** em [04-pendencias.md](04-pendencias.md): o plano ainda não é executável por outra LLM. Faltam 6 decisões suas (bloco A), 16 especificações técnicas (bloco B) e 10 artefatos do pacote de execução (bloco C).
- **Bloco A resolvido (D18–D23):**
  - D18: e-mail replicado via `user.registered`;
  - D19: RDS gerenciado + Redis no cluster;
  - D20: só homolog;
  - D21: Tempo + Loki;
  - D22: budget de 50 USD;
  - D23: repos públicos.
  
  Plano e pendências atualizados.
- **Próximo passo:** escrever `05-especificacao-tecnica.md` com os defaults do bloco B (B1–B16) para revisão.
- **D19 revisada pela D24:** RDS + ElastiCache for Valkey Multi-AZ gerenciado. A revogação de sessão é persistida no Postgres (fonte da verdade), e o Redis vira a camada rápida, reidratada a cada 60 s. Redis fora do ar faz a autenticação falhar fechada (503); o cache da listagem falha aberto. Risco da D19 eliminado.
- **Bloco B escrito** em [05-especificacao-tecnica.md](05-especificacao-tecnica.md): contratos HTTP e de mensagens, falhas e DLQ, modelo de dados, pipeline do worker, outbox, S3, nomes, libs, portas, pacote de contratos, compose, exposição AWS, segredos e IAM, CI e convenções. Foram propostas as decisões técnicas **T01–T08**, pendentes de revisão. RF-14 atualizado: o status `UPLOADED` foi removido (T02).
- **T01–T08 revisadas uma a uma**, com alternativas, e aprovadas nas opções recomendadas → **D25–D32**. A especificação técnica está aprovada e o **bloco B fechado**.
- **Próximo passo:** bloco C. Primeiro a Entrega 1 (C1–C5: ADRs, diagramas, threat model, cloud/FinOps, override da lib), depois o pacote de execução (C6–C10: `AGENTS.md`, playbook, templates, roteiro, checklist).

### Entrega 1 (C1–C5)
- `governance/global-rules.override.yaml`: complex/high/mvp/80, merge validado contra o schema da lib. `cloud_preference` corrigido para `aws-first`.
- **15 ADRs** em `architecture/`, todos com a seção Governance (6 perguntas + classificação). Os ADR-014 (pipeline do worker) e ADR-015 (AWS) foram acrescentados aos 13 do plano.
- `architecture/solution-design.md`: componentes, propriedade dos dados, mapa dos RNF, modos de falha, tiers de escala.
- `architecture/diagrams.md`: C4 de contexto e containers, 3 sequências (upload, sessão, falha), estados e implantação, em Mermaid.
- `security/threat-model.md` (14 ameaças, 6 riscos residuais) e `security/controls-matrix.md`.
- `cloud/option-evaluation.md` (AWS 4,4; EKS 4,2) e `cloud/architecture-overview.md`.
- `finops/implementation-cost-plan.md` (cerca de 9 USD/dia, 5 dias, cerca de 45 USD, redução de 76%) e `optimization-backlog.md`.
- **Lacuna encontrada:** o KEDA escala pods, mas não nós. Foi proposta a **T09 (Cluster Autoscaler)**, pendente de aprovação.
- **T09 aprovada → D33:** Cluster Autoscaler com 2 a 5 nós. O ADR-009 está aceito. **A Entrega 1 está concluída.**
- **Próximo passo:** pacote de execução C6–C10 (`AGENTS.md`, playbook de tarefas, templates de repo, roteiro do vídeo, checklist de entrega).

### Revisão crítica (gate antes do pacote de execução)
- Revisão de aderência ao enunciado, segurança, performance e estrutura: **18 achados** ([06-revisao-critica.md](06-revisao-critica.md)).
- **Achados altos:**
  - S-01: rate limit por IP quebrado atrás do NLB;
  - S-06: senhas no `init.sql`;
  - P-01: worker subdimensionado.
- **D34 (decisão do usuário):** node group spot dedicado ao worker, 1 job por pod com 1 CPU, KEDA de 1 a 9 pods. Revisa a D14.
- Correções aplicadas: especificação (B17), ADR-006/009/014, solution design, diagramas, cloud, threat model (T-15/16, R-07..09), controles e custo (≈ 10,5 USD/dia, ≈ 44,5 USD em 4,25 dias).
- **Conclusão:** nenhuma lacuna conhecida. O plano está apto para o pacote de execução C6–C10.

### Pacote de execução (C6–C10)
- `hackaton/AGENTS.md` (contrato do executor: leitura, precedência, 9 regras invioláveis, pontos de parada humanos, registro) e `CLAUDE.md`, que aponta para ele.
- `docs/execucao/playbook.md`: fases F0–F10, cerca de 60 tarefas, cada uma com referência, dependência e comando de verificação. 🛑 marca as aprovações humanas.
- `docs/execucao/templates/`: Dockerfiles (serviço e worker), dependency-cruiser, jest (gate de 80%), Sonar, `.gitignore`, `.env.example`, `security-gate.sh`, `ci.yml` (CI + CD homolog + release), PR template, k8s (api, worker com KEDA, migrate job). YAML validado.
- `docs/delivery/video-script.md` (8 blocos, ≤ 10 min, contingência) e `docs/delivery/artifacts.md` (PDF → evidência + gates da lib).
- Ajustes na especificação: IRSA do worker com `sqs:GetQueueAttributes` (KEDA) e `prisma` em `dependencies` (Job de migrate).
- **O planejamento está concluído.** O próximo passo é a execução a partir do `AGENTS.md` / playbook F0.

## 2026-11-20: Sessão 3 (execução F0)

### F0.1 — versões (verificação executada)
| Ferramenta | Exigido | Obtido |
|---|---|---|
| Node | 22.x | `v22.17.0` |
| Yarn | 4.x | `4.10.3` |
| Docker Compose | presente | `v5.7.0` (daemon `29.9.3`) |
| Terraform | 1.9+ | `v1.16.0` |
| k6 | presente | `v2.4.0` |
| gitleaks | presente | `8.30.1` |
| git / gh | presentes | `2.39.5` / `2.80.0` (conta `dinhogt`) |
| AWS CLI | v2 | `2.36.37` |
| kubectl | presente | cliente `v1.36.2` |
| Helm | presente | `v4.3.2` |
| ffmpeg / ffprobe | presentes | `9.0.2` |

- O `yarn` global em `/usr/local/bin/yarn` continua no classic `1.22.22`. `corepack enable` falhou com `EACCES` (sem sudo). O `yarn` 4 entra no PATH por `~/.local/yarn4/bin/yarn` (`corepack yarn`) e por uma linha no `~/.zshrc`. `zsh -ic 'yarn -v'` → `4.10.3`.
- k6, Helm e ffmpeg foram instalados via Homebrew nesta sessão. O Docker Desktop foi iniciado nesta sessão.
- **Observação de ambiente:** a máquina tem 8 GiB de RAM no total e o Docker está com cerca de 4,3 GiB (`MemTotal=4628213760`). O ambiente esperado pede cerca de 8 GiB livres. Não bloqueia a F0.1; pode apertar o `make up` da F1.5.

### F0.4 — fixtures
Geradas em `test/fixtures/` (ainda fora dos repos; copiar para `fiapx-video-service/test/fixtures/` quando o clone existir):

| Arquivo | ffprobe |
|---|---|
| `sample-5s.mp4` | h264, 320×240, duração `5.000000`, 109114 bytes |
| `sample-30s.mp4` | 1280×720, duração `30.000000`, 276139 bytes |
| `corrupted.mp4` | falha: `moov atom not found` / `Invalid data found when processing input` (exit 1) |

### F0.2 — repositórios (aprovado e verificado)
Aprovação explícita nesta sessão. Cinco repositórios **públicos**, branch padrão `develop`, branch `master` no mesmo commit inicial `chore: initialize repository`. Clones em `hackaton/fiapx-repos/`.

`gh repo list dinhogt | grep fiapx-`:

```
dinhogt/fiapx-infra
dinhogt/fiapx-notification-service
dinhogt/fiapx-video-worker
dinhogt/fiapx-video-service
dinhogt/fiapx-auth-service
```

Cada um: `private=false`, `default=develop`, branches `develop,master`.

As fixtures da F0.4 foram versionadas só em `develop` do video-service (`0fd1081`, `test/fixtures/`). `gitleaks detect --no-git` no diretório: `no leaks found`. `master` permanece no commit inicial.

### Bloqueios
- **F0.3:** não há `SONAR_TOKEN` no ambiente. Criar os projetos no SonarCloud e gravar o segredo nos repos de serviço continua parado (aprovação humana).
- **EX-01:** resolvida. ESLint flat + Prettier no padrão NestJS 11 / TypeScript strict. Arquivos em `docs/execucao/templates/`.

### F1.1 — scaffold dos quatro serviços (verificado localmente)
Cada serviço em `develop`, ainda sem push deste scaffold:

| Repo | Commit | `yarn lint` | `yarn depcruise` | `yarn test:cov` | `docker build` |
|---|---|---|---|---|---|
| fiapx-auth-service | `864a420` | ok | 0 violações | 100% (4/4) | `fiapx-auth-service:scaffold` |
| fiapx-video-service | `b6901f0` | ok | 0 violações | 100% (4/4) | `fiapx-video-service:scaffold` |
| fiapx-notification-service | `7df529e` | ok | 0 violações | 100% (4/4) | `fiapx-notification-service:scaffold` |
| fiapx-video-worker | `1a6c1e0` | ok | 0 violações | 100% (4/4) | `fiapx-video-worker:scaffold` |

- NestJS 11, TypeScript `strict`, Yarn 4.10.3 com `nodeLinker: node-modules` e binário em `.yarn/releases`.
- Actions do CI fixadas por SHA (T-12). O worker descomenta a instalação do ffmpeg (E-06).
- O `docker build` do worker falhou três vezes com `Hash Sum mismatch` no apt do Debian (o mesmo pacote, baixado no host, confere). O `Dockerfile.worker` ganhou `Acquire::http::Pipeline-Depth 0` e `Acquire::Retries 5`. Com isso o build passou.
- `gitleaks protect --staged`: `no leaks found` nos dois commits de cada repo.
- **F0.3 continua aberta** (sem `SONAR_TOKEN`). O job de qualidade do CI só chama o Sonar se o segredo existir.

## 2026-11-21: Sessão 4 (F1.2 módulos transversais)

### Escopo entregue
Nos quatro serviços: config Zod fail-fast, logger pino com redaction, `X-Correlation-Id`, filtro RFC 7807 (`application/problem+json`), `helmet`, `/health/live`, `/health/ready` (dependências por serviço), `/metrics` (`prom-client`) e OpenTelemetry OTLP HTTP opcional.

Ready por serviço:
- auth: Postgres + Redis
- video: Postgres + Redis + SQS (process e status)
- notification: Postgres + SQS (notifications e user-contacts)
- worker: SQS process (sem `DATABASE_URL`)

### Verificação
| Repo | Commit F1.2 | lint | depcruise | cobertura | boot env inválido | `/health/live` | `docker build` |
|---|---|---|---|---|---|---|---|
| fiapx-auth-service | `264f596` | ok | 0 | ≥ 80% | exit 1 | 200 + correlation | `fiapx-auth-service:f12` |
| fiapx-video-service | `5e47465` | ok | 0 | ≥ 80% | exit 1 | 200 + correlation | `fiapx-video-service:f12` |
| fiapx-notification-service | `a36f510` | ok | 0 | ≥ 80% | exit 1 | 200 + correlation | `fiapx-notification-service:f12` |
| fiapx-video-worker | `9079a3f` | ok | 0 | ≥ 80% | exit 1 | 200 + correlation | `fiapx-video-worker:f12` |

- Teste unitário de redaction verde em todos.
- Resposta 404 em rota inexistente: `application/problem+json`.
- `/health/ready` pode ser 503 sem compose (esperado até F1.5).
- Commits locais em `develop`; sem push. `gitleaks protect --staged`: `no leaks found`.
- Docker Desktop encheu o disco no meio dos builds e ficou read-only; depois do restart, as quatro imagens `:f12` foram geradas.

### Bloqueios
- **F0.3** continua aberta (sem `SONAR_TOKEN`).
- Próxima tarefa do playbook: **F1.3** (pacote `@dinhogt/fiapx-contracts`).

## 2026-11-23: Sessão 5 (F1.3 + push)

### F1.3 — `@dinhogt/fiapx-contracts`
Pacote em `fiapx-video-service/packages/contracts` (yarn workspace):
- envelope v1, 5 mensagens Zod, `failureCode`, nomes de filas/tópicos por env, `buildEnvelope()`
- verificação: `yarn workspace @dinhogt/fiapx-contracts test` → 5 testes verdes (parse válido e inválido)
- regressão do serviço: `yarn lint`, `depcruise`, `test:cov` ≥ 80%, `yarn build` verdes
- Dockerfile do video-service passa a copiar `packages/` antes do `yarn install`
- Commit: `88fc062` em `develop`

### Push GitHub (`develop`)
| Repo | HEAD remoto |
|---|---|
| fiapx-auth-service | `264f596` |
| fiapx-video-service | `88fc062` |
| fiapx-video-worker | `9079a3f` |
| fiapx-notification-service | `a36f510` |

`fiapx-infra` sem commits novos (já alinhado).

### Observações
- `docker build` do video-service com workspace falhou por disco/read-only do Docker Desktop (`EROFS` / EOF). Gates locais da F1.3 passaram; imagem `:f13` não ficou registrada nesta sessão.
- **F0.3** continua aberta.
- Próxima: **F1.4** 🛑 publicar `@dinhogt/fiapx-contracts@1.0.0` no GitHub Packages (aprovação humana).

## 2026-11-24: Sessão 6 (F1.4)

### Pré-checagem GitHub
- `gh` reautenticado (`dinhogt`, scopes `repo` + `write:packages` + `read:packages` + `delete:packages` + `workflow`).
- 5 repos `fiapx-*` já existiam (públicos, default `develop`): auth, video-service, video-worker, notification, infra. Nenhum repo novo criado.
- Pacote `@dinhogt/fiapx-contracts` ainda não existia (só `domain-shared` de outro projeto).
- Escopo de trabalho: apenas `fiapx-repos/fiapx-*` + docs do hackaton (nada em codeOneSolutions).

### F1.4 — publicar `@dinhogt/fiapx-contracts@1.0.0`
- Workflow `publish-contracts.yml` (tag `contracts-v*`) no video-service.
- `.npmrc` nos 3 consumidores apontando `@dinhogt` → `https://npm.pkg.github.com` com `NPM_TOKEN`.
- Tag `contracts-v1.0.0` → Actions run `45517623879` verde (test + build + `npm publish`).
- Verificação: `npm view @dinhogt/fiapx-contracts --registry=https://npm.pkg.github.com` → **1.0.0**.
- Pacote: [fiapx-contracts](https://github.com/users/dinhogt/packages/npm/package/fiapx-contracts), visibility **public**, linked a `dinhogt/fiapx-video-service`.

### Push (`develop`)
| Repo | Commit |
|---|---|
| fiapx-video-service | `3f20596` (+ tag `contracts-v1.0.0`) |
| fiapx-auth-service | `1a78deb` |
| fiapx-video-worker | `f23a4be` |
| fiapx-notification-service | `2539b5f` |

### Observações
- `PUT /user/packages/npm/fiapx-contracts/repositories/{id}` retornou 404 para os 3 consumidores. Com visibility **public**, a leitura via registry autenticado já funciona; o grant granular de Actions não se aplica (ou não está disponível) para pacote público de user.
- **F0.3** continua aberta.
- Próxima: **F1.5** (compose + LocalStack + observability + Makefile).

## 2026-11-25: Sessão 7 (F1.5)

### F1.5 — compose + LocalStack + observability
Em `fiapx-video-service`:
- `docker-compose.yml` (infra + obs; apps/migrações em profile `apps`)
- `localstack/init/ready.d/10-resources.sh` (8 filas, 2 tópicos, 3 inscrições com filtro, bucket `fiapx-local-videos` + lifecycle)
- `observability/` (alloy, prometheus+alerts, loki, tempo, grafana provisionado com dashboard “jornada do vídeo”)
- `Makefile` (`up`, `down`, `logs`, `e2e`, `queues`, `seed-video`)
- `db/init.sql` placeholder (conteúdo S-06 em F1.6)

### Verificação
- `make up` → postgres, redis, localstack, mailpit, alloy, prometheus, loki, tempo, grafana **healthy**
- `awslocal sqs list-queues` → **8 filas** `fiapx-local-*`
- SNS: `video-events` + `user-events`; filtros `video.failed` e `user.registered` (MessageBody)
- S3: `fiapx-local-videos` com lifecycle raw/1d, output/7d, abort multipart/1d

### Push
- `fiapx-video-service` `develop`: `08ca308` (após `6b49e9e`)

### Observações
- Healthcheck do Alloy usa `/dev/tcp` (imagem sem curl/wget).
- **F0.3** continua aberta.
- Próxima: **F1.6** (`db/init.sql` com citext, schemas, roles, grants).

## 2026-11-27: Sessão 8 (F1.6)

### F1.6 — `db/init.sql` (B4 / S-06)
- Canônico: `fiapx-infra/db/init.sql` — `citext`, schemas `auth`/`video`/`notification`, roles `auth_svc`/`video_svc`/`notification_svc`, grants mínimos, senhas via `:'*_password'` (psql `-v`).
- Compose: monta o SQL do infra + wrapper `db/10-run-init.sh` com `AUTH/VIDEO/NOTIFICATION_DB_PASSWORD` fictícios; `.env.local.example` documenta as vars.

### Verificação
```
psql -U auth_svc -c "select * from video.videos"
→ ERROR: permission denied for schema video
```
- `auth_svc` cria/dropa tabela no próprio schema.
- `video_svc` também recebe permission denied em `auth.*`.

### Push (`develop`)
| Repo | Commit |
|---|---|
| fiapx-infra | `ba2a710` |
| fiapx-video-service | `5a8a31e` |

### Observações
- **F0.3** continua aberta.
- Próxima: **F1.7** (copiar `docs/` para `VS/docs/` + override da lib).

## 2026-11-27: Sessão 9 (F1.7)

### F1.7 — docs canônicos + override no video-service
- Copiado `hackaton/docs/` → `fiapx-video-service/docs/` (IDs D/ADR/RF/AC/T/S/P/E preservados).
- Copiada `spec-skills-lib/` para `fiapx-video-service/spec-skills-lib/` (para o validate local).
- Override de governança em `fiapx-video-service/spec-skills-lib/rules/global-rules.override.yaml` (AC-01: complex-flow/high/mvp/NestJS/aws-first/80).

### Verificação
- `bash spec-skills-lib/tools/validate-local.sh` → **All validations passed**
- Merge do override + schema: complex-flow / high / mvp / nestjs-next-react / aws-first / coverage 80

### Push (`develop`)
| Repo | Commit |
|---|---|
| fiapx-video-service | (a registrar após commit) |

### Observações
- **F0.3** continua aberta.
- Fundação F1 concluída (F1.1–F1.7). Próxima fase: **F2** (auth-service).
