# Pendências para o plano ficar executável por qualquer LLM

Critério de "pronto": um executor sem acesso a esta conversa consegue implementar, testar e entregar **sem inventar** nenhuma decisão de arquitetura, nome, contrato ou parâmetro. Tudo o que hoje exigiria um palpite está listado abaixo.

## Situação atual

| Camada | Estado |
|---|---|
| Enunciado, referências, plano de alto nível | ✅ Concluído (`00`, `01`, `03`) |
| Decisões estratégicas (stack, repos, cloud, observabilidade, upload, sessão) | ✅ D01–D17 |
| Requisitos, critérios de aceite, épicos, WBS | ✅ `requirements/` |
| Decisões técnicas de detalhe (bloco A) | ✅ D18–D24 (2026-11-20) |
| Especificações (contratos, dados, nomes, layout) (bloco B) | ✅ [05-especificacao-tecnica.md](05-especificacao-tecnica.md) aprovado; T01–T08 = D25–D32 |
| Pacote de execução para outra LLM (bloco C) | ✅ `AGENTS.md`, `execucao/`, `delivery/` |

---

## Bloco A: decisões com trade-off real ✅ resolvido

Resolvido por: A1 → D18, A2 → D19 → revisada pela **D24**, A3 → D20, A4 → D21, A5 → D22, A6 → D23.

| # | Pendência | Por que importa | Opções |
|---|---|---|---|
| A1 | **Origem do e-mail na notificação** | O notification-service precisa do e-mail do usuário, e e-mail é PII | (a) o evento leva o e-mail; (b) notification consulta o auth (acoplamento síncrono); (c) notification guarda uma réplica `userId → email` alimentada por um evento `user.registered` |
| A2 | **Infra de dados em homolog** | Custo e tempo de provisionamento | RDS + ElastiCache gerenciados (cerca de 13 + 12 USD/mês, como no modelo) ou Postgres e Redis dentro do cluster (mais barato e menos realista) |
| A3 | **Ambientes AWS** | Custo dobrado e esforço de CD | Só homolog (`develop`) com `master` como release taggeada, ou homolog + prod reais |
| A4 | **Backends de traces e logs** | OTel precisa de um destino; o vídeo precisa mostrar o trace | Tempo + Loki (Grafana completo), Jaeger + logs via kubectl, ou só métricas + logs JSON |
| A5 | **Teto de orçamento AWS** | Define o alarme de budget e o momento do destroy | ex.: 50 USD ou 100 USD no total |
| A6 | **Visibilidade dos repos** | Avaliadores precisam de acesso; Sonar gratuito exige repo público | Públicos, ou privados com os avaliadores convidados |

## Bloco B: especificações técnicas ✅ aprovado em `05-especificacao-tecnica.md` (o detalhamento abaixo foi a proposta original)

| # | Pendência | Default proposto |
|---|---|---|
| B1 | Contrato HTTP (OpenAPI) | Rotas, payloads, erros em RFC 7807 (`application/problem+json`), paginação por cursor, códigos de status por rota |
| B2 | Contrato de mensageria | Envelope v1 (`messageId`, `type`, `version`, `occurredAt`, `correlationId`, `traceparent`, `payload`); mensagens `video.process` (comando), `video.processing`, `video.processed`, `video.failed` e `user.registered` (eventos; D18) |
| B3 | Quem marca PROCESSING e FAILED | O worker publica `video.processing` ao iniciar. **Erro permanente** (ffprobe inválido, sem frames) gera `video.failed` imediato, sem retry. **Erro transitório** tem retry; na última tentativa (`ApproximateReceiveCount ≥ 3`) o worker publica `video.failed` antes de a mensagem ir para a DLQ. A DLQ só dispara alarme. |
| B4 | Modelo de dados | `auth.users`, `auth.sessions`, `auth.refresh_tokens`; `video.videos`, `video.outbox`, `video.inbox`; `notification.inbox` (idempotência), `notification.user_contacts` (D18) |
| B5 | Estado do worker | Sem banco. A idempotência vem do status recebido + existência de `output/{videoId}.zip` no S3. Disco temporário em `emptyDir` com limite de 2 Gi. |
| B6 | Outbox relay | Polling a cada 1 s, `SELECT … FOR UPDATE SKIP LOCKED`, lote de 50, seguro com várias réplicas |
| B7 | Layout do S3 | Bucket `fiapx-<env>-videos`, chaves `raw/{userId}/{videoId}.{ext}` e `output/{userId}/{videoId}.zip` |
| B8 | Nomes de recursos | Filas `fiapx-<env>-video-process[-dlq]`, `-video-status-updates[-dlq]`, `-notifications[-dlq]`; tópicos `fiapx-<env>-video-events` e `fiapx-<env>-user-events`; fila `fiapx-<env>-user-contacts[-dlq]` |
| B9 | Ferramentas | yarn 4 (como o modelo), Prisma, `jose` (JWT), `argon2`, AWS SDK v3, `archiver` (zip), `child_process.spawn` (ffmpeg), Jest, Testcontainers, Cucumber, k6 |
| B10 | Portas e saúde | auth 3001, video 3002, worker 3003 (só health e métricas), notification 3004; `/health/live`, `/health/ready`, `/metrics` |
| B11 | Distribuição do pacote de contratos | `@dinhogt/fiapx-contracts` no GitHub Packages, publicado pelo video-service (igual ao `domain-shared` do modelo) |
| B12 | Compose multi-repo | O `docker-compose.yml` no video-service faz build de `../fiapx-*` (clones irmãos), com override para imagens do GHCR |
| B13 | Ingress na AWS | API Gateway HTTP + VPC Link + NLB (reuso do modelo), sem ALB controller |
| B14 | Segredos | Chave privada RS256, `DATABASE_URL` e Redis (endpoint + AUTH token, D24) no Secrets Manager, injetados via External Secrets ou script de CD (padrão do modelo) |
| B15 | Gates de CI | Cobertura ≥ 80%, Trivy falha em CRITICAL/HIGH com correção disponível, `yarn npm audit` falha em high |
| B16 | Convenções | Conventional Commits, template de PR, branch `feature/*` → `develop` → `master`, SemVer por tag |

## Bloco C: pacote de execução (para outra LLM executar)

| # | Artefato | Conteúdo |
|---|---|---|
| C1 ✅ | ADRs 001–015 escritos (`architecture/`) | Formato do modelo + seção Governance |
| C2 ✅ | Solution design + diagramas | C4 de contexto e de containers, sequência do fluxo feliz e do fluxo de falha, estados, deploy |
| C3 ✅ | Threat model + controls matrix | STRIDE por fronteira, ASVS L1 + controles L2 selecionados |
| C4 ✅ | Cloud + FinOps | Opções avaliadas, custo mensal estimado, plano de destroy |
| C5 ✅ | `governance/global-rules.override.yaml` | complex/high/mvp/80/aws |
| C6 ✅ | **`AGENTS.md` do workspace** | Ordem de leitura, regras invioláveis (sem segredos, sem `terraform apply` sem aprovação, não alterar `projeto-fiapx`), como registrar decisões e histórico |
| C7 ✅ | **Playbook de execução** | Tarefas atômicas por repo, na ordem, cada uma com entradas, saídas, Definition of Done e comando de verificação |
| C8 ✅ | Templates de repo | Estrutura de pastas NestJS hexagonal, Dockerfile, workflow de CI, `sonar-project.properties`, `.dependency-cruiser.cjs` |
| C9 ✅ | Roteiro do vídeo de 10 min | Blocos cronometrados, igual ao `video-script-fase4.md` do modelo |
| C10 ✅ | Checklist de entrega | `artifacts.md`: requisito do PDF → evidência |

## Ordem sugerida para fechar
1. ~~Bloco A (decisões suas)~~ ✅
2. ~~B1–B16~~ ✅ aprovado (D25–D32).
3. ~~C1–C5 (Entrega 1)~~ ✅. T09 aprovada (D33).
4. ~~C6–C10 (pacote de execução)~~ ✅

**Plano completo e pronto para execução (2026-11-20).** O ponto de entrada é o `hackaton/AGENTS.md`.

Depois disso o plano está pronto para ser executado por outra LLM.
