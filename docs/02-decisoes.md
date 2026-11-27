# Registro de decisões

Cada decisão registra a pergunta, as opções, a escolha e o motivo. As decisões de arquitetura viram ADRs formais na implementação (ver a seção 2 do [plano](01-plano-arquitetura.md)).

## 2026-11-19: Sessão 1 (planejamento)

| # | Tema | Opções consideradas | Escolha | Motivo |
|---|---|---|---|---|
| D01 | Stack dos serviços | NestJS/TS · Go (projeto base) · Híbrido NestJS + worker Go | **NestJS/TS** | Reuso de padrões, testes, CI e K8s do autoservicemanager. É o stack oficial da spec-skills-lib (Go exigiria ADR de exceção). |
| D02 | Ambiente | AWS EKS · Só local (Compose/kind) · Híbrido | **Híbrido** | Demo local completa com custo zero, e deploy em AWS via Terraform/CI para aderência ao curso |
| D03 | Equipe e prazo | Solo 2–3 semanas · Grupo · Solo < 1 semana | **Solo, cerca de 3 semanas** | Define o escopo: 4 serviços e 1 repo de infra |
| D04 | Repositórios | Monorepo · Multi-repo | **Multi-repo (como o modelo)** | Fiel ao projeto modelo. A infra fica num único repo com 2 states para reduzir overhead. |
| D05 | Conta AWS | Pessoal · AWS Academy (LabRole) | **Pessoal** | Permite reaproveitar IAM, GitHub OIDC e IRSA do Terraform do modelo |
| D06 | Observabilidade | Prometheus+Grafana+OTel · CloudWatch+X-Ray · Ambos | **Prometheus + Grafana + OTel** | Recomendado no enunciado. Funciona igual no ambiente local e no EKS, e fica visível no vídeo. |
| D07 | Upload | URL pré-assinada do S3 · Multipart via API | **URL pré-assinada** | A API não vira gargalo em picos. Escala melhor. |
| D08 | Interface de demo | Página HTML estática · Só Postman | **Só Postman** | Menos código. A collection encadeia o token, a URL pré-assinada e o polling. |
| D09 | Taxa de frames | Parâmetro com limite · Fixo em 1 fps | **Parâmetro opcional, padrão 1, de 0.1 a 5** | Flexível e protegido contra jobs abusivos |
| D10 | GitHub e branches | dinhogt main/develop · dinhogt master/develop · outra org | **dinhogt, `fiapx-*`, master/develop** | Igual ao modelo: develop vai para homolog e master para produção |
| D11 | Pasta local dos repos | `hackaton/fiapx-repos/` · direto em `hackaton/` | **`hackaton/fiapx-repos/`** | Separa os clones das referências |
| D12 | Documentação e histórico | — | **`hackaton/docs/`** | Pasta local com o enunciado, o plano, as decisões e o histórico |

## 2026-11-20: Sessão 2 (requisitos)

| # | Tema | Opções consideradas | Escolha | Motivo |
|---|---|---|---|---|
| D13 | Limites de upload | 500 MB, 5 formatos · 1 GB + wmv/flv · 200 MB, mp4/mov | **500 MB; mp4, mov, avi, mkv, webm** | Atende a demo com tempo e custo de ffmpeg controlados |
| D14 | Resiliência e escala do worker (**pods, jobs e CPU revisados pela D34**; 3 tentativas e timeout de 15 min mantidos) | 3 tentativas/15 min/1–10 pods × 2 · 5 tentativas/30 min/1–5 × 1 | **3 tentativas, timeout de 15 min, 1–10 pods × 2 jobs** | Falha definitiva rápida (DLQ) e até 20 vídeos em paralelo |
| D15 | E-mail de sucesso | Só falha · Falha e sucesso | **Só falha** | É o que o enunciado pede. Menos ruído e menos cota do SES em sandbox. RF-13 vira Won't. |
| D16 | Sessão e senha | 15 min sem refresh · 15 min + refresh 7 d · 60 min sem refresh · *outra* | **Access 60 min + refresh 60 min deslizante enquanto a sessão estiver em uso. Prioridade: segurança.** | Escolha do usuário. Os controles abaixo compensam o access mais longo. |

### Controles derivados da D16 (entram no ADR-006)
- O **refresh token é opaco**: 256 bits aleatórios, guardado só como hash SHA-256 no Postgres (`auth.sessions` / `auth.refresh_tokens`).
- **Rotação a cada uso:** o refresh é de uso único e cada `/auth/refresh` emite um novo par. A inatividade máxima é de 60 min.
- **Detecção de reuso:** reapresentar um refresh já usado revoga toda a sessão (`sid`) e registra um evento de segurança. Isso mitiga refresh token roubado.
- **Limite absoluto de 8 h por sessão**, mesmo em uso contínuo, o que exige login de novo.
- **Revogação imediata do access token:** o JWT carrega `sid`. No logout, ou quando há reuso, o `sid` entra numa lista de revogação no Redis com TTL igual à vida restante do access. Os serviços checam essa lista em toda requisição. O authorizer do API Gateway não consegue fazer essa checagem, por isso ela é responsabilidade do serviço (defesa em profundidade).
- Rate limit em `/auth/login` (5 tentativas por minuto por e-mail e por IP) e em `/auth/refresh`. Mensagens genéricas evitam enumeração de usuário.
- A senha tem no mínimo 12 caracteres, é checada contra uma lista de senhas comuns e o hash é argon2id.
- Claims do JWT: `iss`, `aud`, `sub`, `sid`, `jti`, `iat` e `exp`. A chave RS256 é rotacionável via `kid` no JWKS.
- **Trade-off registrado:** um access de 60 min aumenta a janela de uso de um token vazado. A revogação por `sid` reduz o impacto quando a sessão é encerrada, mas um token vazado sem logout continua válido até expirar. Alternativa mais segura e com a mesma experiência: access de 15 min com refresh de 60 min deslizante. **Resolvido pela D17.**

## 2026-11-20: Sessão 2 (revisão da D16)

| # | Tema | Opções consideradas | Escolha | Motivo |
|---|---|---|---|---|
| D17 | Duração do access token (**substitui parte da D16**) | 60 min (D16) · 15 min | **Access de 15 min.** O resto da D16 continua: refresh opaco rotativo com 60 min de inatividade, detecção de reuso, limite absoluto de 8 h, revogação por `sid` no Redis. | Garante a integridade da sessão: reduz de 60 para 15 min a janela de uso de um access token vazado. A experiência do usuário não muda, porque o refresh deslizante mantém a sessão enquanto há uso e a collection do Postman renova o token sozinha. A revogação por `sid` continua cobrindo o logout dentro dos 15 min. |

**Política de sessão vigente (vai para o ADR-006):**

| Parâmetro | Valor |
|---|---|
| Access token | JWT RS256, **15 min**, claims `iss/aud/sub/sid/jti/iat/exp`, `kid` no JWKS |
| Refresh token | Opaco, 256 bits, hash SHA-256 no Postgres, uso único, **60 min de inatividade** |
| Sessão | Deslizante enquanto há uso, **limite absoluto de 8 h** |
| Revogação | Logout ou reuso de refresh põem o `sid` na lista do Redis (TTL ≤ 15 min), checada pelos serviços |
| Rate limit | Login: 5 tentativas/min por e-mail e por IP. Refresh também limitado. |

## 2026-11-20: Sessão 2 (bloco A de pendências)

| # | Tema | Opções consideradas | Escolha | Motivo |
|---|---|---|---|---|
| D18 | Origem do e-mail na notificação (A1) | E-mail no evento · Consulta HTTP ao auth · Réplica via evento | **Réplica via `user.registered`.** O auth publica no SNS `fiapx-<env>-user-events` e o notification guarda `notification.user_contacts (user_id, email)`. | Desacoplado e sem dado pessoal nos eventos de vídeo nem na DLQ. Se o e-mail ainda não tiver sido replicado, a notificação faz retry. |
| D19 | ~~Banco e cache em homolog (A2)~~ **Substituída pela D24** | RDS + ElastiCache · Ambos no cluster · RDS + Redis no cluster | **RDS Postgres gerenciado + Redis no cluster** (Deployment com 1 réplica, sem persistência) | O dado durável fica gerenciado (backup, SSE, rede privada). O Redis guarda só cache, rate limit e lista de revogação: perder esses dados é tolerável e o custo cai. **Risco aceito:** se o Redis reiniciar, a lista de revogação se perde, e um access já revogado volta a valer por até 15 min. No ambiente local, o compose sobe tudo. |
| D20 | Ambientes AWS (A3) | Só homolog · Homolog + prod | **Só homolog.** `develop` faz deploy em homolog. `master` gera release taggeada (imagem com SemVer) e o prod só tem `terraform plan` documentado. | Custo pela metade, mantendo o fluxo de promoção descrito |
| D21 | Traces e logs (A4) | Tempo + Loki · Jaeger + kubectl · Só métricas | **OTel Collector → Tempo (traces) + Loki (logs) + Prometheus (métricas) no Grafana**, com salto do log para o trace por `trace_id` | Uma interface só para o vídeo. Atende o gate de traces da lib. Funciona igual no compose e no EKS (Helm). |
| D22 | Teto de orçamento AWS (A5) | 50 · 100 · outro | **50 USD no total**, com AWS Budgets alertando em 50%, 80% e 100% | Homolog sobe só para validar, gravar e avaliar, e é destruída entre sessões (cerca de 5 USD/dia). O Terraform precisa de destroy e recriação confiáveis. |
| D23 | Visibilidade dos repos (A6) | Públicos · Privados | **Públicos** | SonarCloud e GitHub Packages gratuitos, acesso direto dos avaliadores. Exige que o security-gate rode em todo PR. |

## 2026-11-20: Sessão 2 (revisão da D19)

| # | Tema | Opções consideradas | Escolha | Motivo |
|---|---|---|---|---|
| D24 | Redis robusto e persistente (**substitui a D19**) | Redis no cluster (D19) · ElastiCache sozinho · **ElastiCache + Postgres como fonte da verdade** | **RDS Postgres gerenciado + ElastiCache for Valkey gerenciado (primário + réplica Multi-AZ, failover automático, TLS, AUTH, SSE, snapshot diário). A revogação de sessão é persistida no Postgres; o Redis é só a camada rápida, reidratada a partir do banco.** | Remove os dois riscos da D19: (1) infraestrutura, porque um pod reiniciado deixava de ser ponto único de falha; (2) dados, porque o Redis deixa de ser a única cópia da revogação. Cabe no budget da D22: cerca de 0,8 USD/dia, com o ambiente destruído entre sessões. |

**Desenho da revogação (vai para o ADR-006 e o ADR-008):**

| Aspecto | Regra |
|---|---|
| Fonte da verdade | `auth.sessions.revoked_at` no Postgres, gravado na mesma transação do logout ou da detecção de reuso de refresh |
| Camada rápida | O auth grava `revoked:sid:{sid}` no Redis com TTL de 15 min (vida máxima do access) logo depois do commit |
| Reidratação | Na subida do auth e a cada 60 s, um job republica no Redis os `sid` revogados nos últimos 15 min. Isso cobre failover, flush ou perda de chave. |
| Verificação nos serviços | Toda requisição autenticada consulta `revoked:sid:{sid}` no Redis (O(1)). Os serviços não acessam o banco do auth (database per service). |
| Redis indisponível | **Fail-closed:** endpoints autenticados respondem 503. Nunca aceitam um token sem conseguir checar a revogação. O alerta `redis_unavailable` tem runbook. |
| Outros usos do Redis | Rate limit de login e refresh: se o Redis cair, **também fail-closed** no login (429/503). Cache da listagem: **fail-open**, com fallback para o Postgres, porque é só desempenho. |
| Ambiente local | Container Redis com `appendonly yes` e volume nomeado, com o mesmo comportamento de persistência |

**Custo estimado:** RDS `db.t4g.micro` mais ElastiCache `cache.t4g.micro` × 2 dão cerca de 1,2 USD/dia, somados aos cerca de 5 USD/dia de EKS e NAT. Continua dentro do teto de 50 USD com destroy entre sessões.

## 2026-11-20: Sessão 2 (revisão de T01–T08 da especificação técnica)

Cada decisão técnica foi apresentada com alternativas, e as recomendadas foram aprovadas. Os detalhes estão em [05-especificacao-tecnica.md](05-especificacao-tecnica.md).

| # | Ref. | Tema | Alternativas descartadas | Escolha | Motivo |
|---|---|---|---|---|---|
| D25 | T01 | Upload ao S3 | PUT + checagem no confirm · multipart presigned | **Presigned POST** com `content-length-range` e `Content-Type` | O S3 impõe o limite de 500 MB. O Postman preenche o form-data por script. |
| D26 | T02 | Estado UPLOADED | UPLOADED via evento S3 → SQS | **Sem UPLOADED**: `PENDING_UPLOAD → QUEUED → PROCESSING → COMPLETED\|FAILED` (+ `EXPIRED`) | O confirm verifica e enfileira na mesma transação. Uma fila e um consumidor a menos. |
| D27 | T03 | Extração de frames | Extração única com disco grande · image2pipe | **Janelas de 60 s + zip em streaming** (`emptyDir` de 3Gi) | Pico de disco limitado sem volume caro. Testável. |
| D28 | T04 | Limite por vídeo | 1.800 frames · sem limite | **3.600 frames** (`VIDEO_TOO_LONG`) | 60 min a 1 fps ou 12 min a 5 fps. Protege custo e tempo. |
| D29 | T05 | NLB → pods | AWS LB Controller · ALB Ingress | **NodePort + target type `instance`** (ASG attachment) | Funciona com HPA e KEDA sem componente extra. Corrige o registro manual de IP de pod do modelo. |
| D30 | T06 | Issuer do JWT | S3 + CloudFront (modelo) | **Issuer = URL do API Gateway.** O auth serve o discovery e o JWKS em rotas públicas. | Nada de infra extra. Rotação de chave via `kid` sem republicar pelo Terraform. |
| D31 | T07 | Coletor de telemetria | OTel Collector + Promtail · OTel Collector com logs via OTLP | **Grafana Alloy** (OTLP para Tempo, logs de container para Loki) | Um agente só, igual no compose e no EKS. Não perde logs de crash. |
| D32 | T08 | Publicação de `user.registered` | Publicação direta + retry | **Outbox transacional no auth-service** | Garante a réplica de contato da D18. Reaproveita o código de outbox. |

## 2026-11-20: Sessão 2 (Entrega 1)

| # | Tema | Situação |
|---|---|---|
| D33 (T09) | **Cluster Autoscaler** (Helm + IRSA), node group `t3.medium` de 2 a 5 nós, para comportar o KEDA do worker (até 10 pods), as APIs e a observabilidade | ✅ **Aprovada.** Alternativas descartadas: Karpenter (configuração e IAM demais para a demo) e nós fixos com worker limitado (exigiria rever a D14). |
| Nota | `cloud_preference: aws-first` no override: o valor `aws-exception` do modelo não existe no schema da lib | Correção técnica, sem impacto de arquitetura |
| Nota | A estimativa de custo da homolog foi revista de cerca de 5 para **cerca de 9 USD/dia**, com o detalhamento em `finops/` | O budget de 50 USD continua viável: cerca de 5 dias ligada |

## 2026-11-20: Sessão 2 (revisão crítica antes do pacote de execução)

Detalhes em [06-revisao-critica.md](06-revisao-critica.md): 18 achados, todos resolvidos.

| # | Tema | Alternativas descartadas | Escolha | Motivo |
|---|---|---|---|---|
| D34 | Capacidade do worker (**revisa a D14**: pods, jobs e CPU) | Pool dedicado on-demand · pool único t3 com worker reduzido | **Node group spot dedicado** (`c7i/c6i/m6i.xlarge`, 1–3 nós, taint), **1 job por pod** com 1 CPU garantida (limit 2), **KEDA de 1 a 9 pods**, ou seja, até 9 vídeos em paralelo | O desenho anterior (2 jobs com 500m em t3 burstable) não entregava o paralelismo prometido. A interrupção spot já é coberta pela idempotência. Custo de cerca de +1,5 USD/dia. |

As 17 correções técnicas (S-01..09, P-02..03, E-01..06) foram aplicadas na especificação (seção B17), nos ADRs 006, 009 e 014, no threat model e na matriz de controles. Não alteram decisões estratégicas.

## Decisões propostas no plano (ainda viram ADR)
- Microsserviços: auth, video, worker e notification.
- Hexagonal pragmático com dependency-cruiser.
- SQS para comandos e SNS → SQS para eventos, com DLQ.
- Outbox transacional com relay em background, inbox de idempotência e worker idempotente.
- Auth próprio: argon2id, JWT RS256, JWKS, autorizador do API Gateway e revalidação do token nos serviços, com refresh rotativo e revogação por `sid` (D16).
- PostgreSQL com schema por serviço, migrações Prisma e `db/init.sql`.
- Redis gerenciado (ElastiCache for Valkey Multi-AZ, D24) para cache da listagem, rate limit e camada rápida de revogação. A fonte da verdade fica no Postgres.
- EKS + HPA + KEDA.
- LocalStack no ambiente local.
- Notificação por SES na AWS e Mailpit no ambiente local, com réplica de contato via `user.registered` (D18).
- Cobertura mínima de 80% como gate no Sonar.

## Pendências do executor
Registre aqui qualquer lacuna ou contradição encontrada durante a execução (regra 3 do `AGENTS.md`). Formato: `| ID | Data | Tarefa | Dúvida | Status (ABERTA/RESOLVIDA) | Resolução |`

| ID | Data | Tarefa | Dúvida | Status | Resolução |
|---|---|---|---|---|---|
| EX-01 | 2026-11-20 | F1.1 | O playbook manda copiar de `docs/execucao/templates/` os arquivos `.editorconfig`, `eslint.config.mjs` e `.prettierrc`. Esses três arquivos não existem na pasta (o `templates/README.md` também não os lista). B9 só diz "ESLint (flat) + Prettier". Posso escrever esses três arquivos no padrão NestJS 11 / TypeScript strict, sem regra extra de arquitetura? | RESOLVIDA | Sim. ESLint flat (`typescript-eslint` recommendedTypeChecked + `eslint-config-prettier`) e Prettier no padrão Nest (aspas simples, trailing comma). Arquivos gravados em `docs/execucao/templates/` e copiados nos quatro serviços. |
