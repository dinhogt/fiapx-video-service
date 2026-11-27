# Especificação técnica (bloco B)

| Campo | Valor |
|---|---|
| Status | **Aprovada** (2026-11-20). T01–T08 revisadas uma a uma e aprovadas (D25–D32). |
| Escopo | Fecha os itens B1–B16 de [04-pendencias.md](04-pendencias.md) |
| Base | Decisões D01–D24 ([02-decisoes.md](02-decisoes.md)) e requisitos ([requirements/](requirements/)) |
| Regra | Um executor deve seguir este documento literalmente. Qualquer desvio exige uma nova decisão registrada. |

---

## 0. Decisões técnicas introduzidas por esta especificação (aprovadas: T01–T08 = D25–D32)

| # | Decisão | Motivo |
|---|---|---|
| T01 | **Upload via presigned POST** (não PUT), com a condição `content-length-range` 1–500 MB e `Content-Type` fixo | Só o POST permite que o S3 imponha o tamanho máximo. Com PUT, o cliente poderia enviar mais que o declarado. |
| T02 | **Status `UPLOADED` removido.** O ciclo é `PENDING_UPLOAD → QUEUED → PROCESSING → COMPLETED \| FAILED`, mais `EXPIRED` | O confirm verifica o objeto e enfileira na mesma transação, então não existe intervalo em que `UPLOADED` fosse observável |
| T03 | **Extração em janelas de 60 s**: ffmpeg por janela, frames adicionados ao zip em streaming e apagados logo depois | Limita o disco do pod. Um vídeo de 1 h a 5 fps geraria cerca de 18 mil PNGs (cerca de 50 GB) de uma vez. |
| T04 | **Limite de 3.600 frames por vídeo** (`duração × fps`, checado por ffprobe). Acima disso, falha com `VIDEO_TOO_LONG` | Protege disco, tempo e custo. Equivale a 60 min a 1 fps ou 12 min a 5 fps. |
| T05 | **NLB com target type `instance` e Services NodePort**, no lugar do registro de IPs de pod do modelo | O modelo registrava IPs de pod manualmente, o que quebra quando o HPA ou o KEDA criam e removem pods. Com targets de nó (ASG attachment), o tráfego segue os pods automaticamente. |
| T06 | **Issuer do JWT = URL do API Gateway.** O auth-service serve `/.well-known/openid-configuration` e `/.well-known/jwks.json` por rotas públicas do próprio gateway | O authorizer JWT do API Gateway exige descoberta OIDC. Isso dispensa o S3 + CloudFront do modelo. |
| T07 | **Grafana Alloy** como coletor: recebe OTLP (traces → Tempo), coleta logs de container (→ Loki) e repassa as métricas ao Prometheus | É uma distribuição compatível com OTel e implementa a D21 com um agente só, igual no compose e no EKS |
| T08 | **`auth-service` também usa outbox**, para o evento `user.registered` | Sem isso, o cadastro poderia acontecer sem a réplica de contato (D18) e a notificação de falha não chegaria |

---

## B1. Contrato HTTP

### Convenções gerais
- O JSON segue camelCase. As datas seguem ISO-8601 UTC. Os IDs são UUID v4.
- O header `X-Correlation-Id` é aceito e propagado. Se não vier, é gerado um, sempre devolvido na resposta.
- Os erros seguem **RFC 7807** (`application/problem+json`): `{ type, title, status, detail, instance, correlationId, errors? }`. `errors` traz `[{ field, message }]` em 400.
- As mensagens de erro são em pt-BR e genéricas em autenticação, para evitar enumeração de usuários.
- O OpenAPI é gerado pelo `@nestjs/swagger`, exportado para `docs/api/openapi-<svc>.json` e versionado. A UI `/docs` só fica habilitada fora de homolog.

### auth-service
| Método e rota | Auth | Request | Sucesso | Erros |
|---|---|---|---|---|
| `POST /auth/register` | — | `{ name (2–120), email, password (12–128) }` | 201 `{ id, name, email, createdAt }` | 400, 409 e-mail em uso, 429 |
| `POST /auth/login` | — | `{ email, password }` | 200 `TokenPair` | 400, 401 genérico, 429 (5/min por e-mail e por IP), 503 se o Redis estiver fora (D24) |
| `POST /auth/refresh` | — | `{ refreshToken }` | 200 `TokenPair` (refresh rotacionado) | 401 (inválido, expirado, reuso → revoga a sessão), 429 (20/min por IP) |
| `POST /auth/logout` | Bearer | — | 204 (revoga o `sid`) | 401 |
| `GET /auth/me` | Bearer | — | 200 `{ id, name, email }` | 401 |
| `GET /.well-known/openid-configuration` | — | — | 200 `{ issuer, jwks_uri }` | — |
| `GET /.well-known/jwks.json` | — | — | 200 JWKS (chave pública RS256 com `kid`) | — |

`TokenPair` = `{ accessToken, tokenType: "Bearer", expiresIn: 900, refreshToken, refreshExpiresIn: 3600 }`

### video-service
| Método e rota | Auth | Request | Sucesso | Erros |
|---|---|---|---|---|
| `POST /videos` | Bearer | `{ fileName, sizeBytes, contentType, fps? }` | 201 `{ videoId, status: "PENDING_UPLOAD", upload: { url, method: "POST", fields: {…}, expiresAt } }` | 400, 401 |
| `POST /videos/{id}/confirm` | Bearer | — | 202 `{ videoId, status: "QUEUED" }`. Idempotente: se já passou de PENDING_UPLOAD, devolve 202 com o status atual. | 401, 404, 409 objeto ausente no S3 ou EXPIRED |
| `GET /videos?limit=20&cursor=` | Bearer | `limit` de 1 a 100 | 200 `{ items: VideoView[], nextCursor }` | 400, 401 |
| `GET /videos/{id}` | Bearer | — | 200 `VideoView` | 401, 404 |
| `GET /videos/{id}/download` | Bearer | — | 200 `{ url, expiresAt }` (GET pré-assinado, 5 min, `Content-Disposition: attachment` com nome sanitizado, S-02) | 401, 404, 409 se não estiver COMPLETED, **410 depois de `outputExpiresAt`** (E-03) |

`VideoView` = `{ videoId, fileName, status, fps, sizeBytes, frameCount?, zipSizeBytes?, failureCode?, failureMessage?, createdAt, updatedAt, completedAt?, outputExpiresAt? }` (`outputExpiresAt = completedAt + 7 dias`)

**Validações de `POST /videos`:**
| Campo | Regra |
|---|---|
| `fileName` | 1–255 caracteres, sem `/` nem `\`. A extensão define o tipo. |
| `contentType` | Tem que corresponder à extensão: `.mp4 → video/mp4`, `.mov → video/quicktime`, `.avi → video/x-msvideo`, `.mkv → video/x-matroska`, `.webm → video/webm` |
| `sizeBytes` | De 1 a 524 288 000 (500 MB) |
| `fps` | Número de 0.1 a 5, em múltiplos de 0.1. O padrão é 1. |

**Paginação:** ordem `createdAt DESC, id DESC`. O cursor é `base64url(createdAt|id)`.

**Autorização:** todo acesso filtra por `userId = sub` do token. Um vídeo de outro usuário retorna **404**, nunca 403 (RNF-07).

### Validação de token nos serviços (video-service e o próprio auth em `/auth/me` e `/auth/logout`)
1. Assinatura RS256 pelo JWKS (cache de 10 min, refetch quando o `kid` é desconhecido).
2. `iss`, `aud = "fiapx-api"`, `exp` e `nbf`, com tolerância de 30 s.
3. `revoked:sid:{sid}` no Redis. Se existir, 401. Se o Redis estiver fora, **503 fail-closed** (D24).

### Endpoints comuns a todos os serviços
`GET /health/live`, `GET /health/ready` (Postgres, Redis e SQS conforme o serviço) e `GET /metrics`. Nenhum é exposto no API Gateway.

---

## B2. Contrato de mensageria

### Envelope v1 (pacote `@dinhogt/fiapx-contracts`, validado com zod no consumo)
```json
{
  "messageId": "uuid",
  "type": "video.process",
  "version": 1,
  "occurredAt": "2026-11-20T12:00:00.000Z",
  "source": "video-service",
  "correlationId": "uuid",
  "causationId": "uuid | null",
  "traceparent": "00-<trace>-<span>-01",
  "payload": { }
}
```
O SNS publica com o atributo de mensagem `type`, que é usado no filter policy. As inscrições usam **raw message delivery**.

### Mensagens
| Tipo | Classe | Produtor → destino | Payload |
|---|---|---|---|
| `video.process` | comando | video-service (outbox) → SQS `video-process` | `{ videoId, userId, inputKey, outputKey, fps, fileName }` |
| `video.processing` | evento | worker → SNS `video-events` | `{ videoId, userId, attempt, startedAt }` |
| `video.processed` | evento | worker → SNS `video-events` | `{ videoId, userId, outputKey, frameCount, zipSizeBytes, durationMs, completedAt }` |
| `video.failed` | evento | worker → SNS `video-events` | `{ videoId, userId, fileName, failureCode, failureMessage, attempts, failedAt }` |
| `user.registered` | evento | auth-service (outbox) → SNS `user-events` | `{ userId, email, name, registeredAt }` |

**`failureCode`:** `INPUT_NOT_FOUND`, `INVALID_VIDEO`, `VIDEO_TOO_LONG`, `NO_FRAMES`, `TIMEOUT`, `PROCESSING_ERROR`. `failureMessage` é um texto pt-BR seguro, sem stack trace nem saída do ffmpeg.

### Roteamento
| Tópico | Inscrição (fila) | Filtro | Consumidor |
|---|---|---|---|
| `video-events` | `video-status-updates` | todos | video-service |
| `video-events` | `notifications` | `type = video.failed` (D15) | notification-service |
| `user-events` | `user-contacts` | `type = user.registered` | notification-service |

### Ordem e idempotência
- As filas são SQS Standard (at-least-once, sem ordem garantida).
- Toda mensagem consumida passa pela **inbox** (`message_id` PK) na mesma transação do efeito.
- A atualização de status é **monotônica**. O `UPDATE` só ocorre se a transição for válida:
  - `QUEUED → PROCESSING`
  - `QUEUED | PROCESSING → COMPLETED | FAILED`
- Um evento fora de ordem (por exemplo, `processing` depois de `processed`) é registrado na inbox e ignorado.

---

## B3. Falhas, retentativas e DLQ

| Situação | Comportamento |
|---|---|
| Erro **permanente**: `INPUT_NOT_FOUND`, `INVALID_VIDEO` (ffprobe sem stream de vídeo), `VIDEO_TOO_LONG`, `NO_FRAMES` | O worker publica `video.failed` **imediatamente** e apaga a mensagem. Não há retry. |
| Erro **transitório**: S3, SNS, ffmpeg com crash ou `TIMEOUT` | O worker não apaga a mensagem. Ela volta depois do visibility timeout. |
| Última tentativa (`ApproximateReceiveCount ≥ 3`) com erro transitório | O worker publica `video.failed` (`TIMEOUT` ou `PROCESSING_ERROR`) e **apaga** a mensagem |
| Crash do pod sem publicar nada (OOM, kill) | Depois de 3 recebimentos a mensagem vai para a **DLQ**. Dispara o alarme `dlq_messages > 0`. O runbook manda reprocessar via redrive, ou marcar como falha pelo script `scripts/fail-video.ts`. |
| Vídeo em QUEUED há mais de 5 min sem `processing` | Alerta `videos_stuck_queued` (RNF-01) |
| Upload não confirmado em 24 h | Um job no video-service (cron a cada 1 h) marca como `EXPIRED` (RF-15) |
| Falha ao publicar a outbox | `attempts++` e `last_error`. Tenta de novo no próximo ciclo. Alerta quando `outbox_oldest_pending_seconds > 60`. |
| Notificação sem contato replicado | O consumidor lança erro, a mensagem tenta de novo (máximo 5) e depois vai para a DLQ com alarme |

**Visibility timeout:**
- A fila `video-process` tem VT de 120 s.
- O worker faz heartbeat com `ChangeMessageVisibility(120 s)` a cada 60 s enquanto processa.
- O timeout total do ffmpeg por vídeo é de 15 min (D14).

---

## B4. Modelo de dados (PostgreSQL 16, um schema por serviço)

O script `db/init.sql`, no repo `fiapx-infra` e montado também no compose:
- cria a extensão `citext`;
- cria os schemas `auth`, `video` e `notification`;
- cria os roles `auth_svc`, `video_svc` e `notification_svc`. Cada um tem `USAGE`/`CREATE` só no próprio schema e nenhum acesso aos outros.

As tabelas são criadas pelas **migrações Prisma** de cada serviço, executadas por um Job `migrate-<svc>`.

### auth
| Tabela | Colunas |
|---|---|
| `users` | `id uuid PK`, `name varchar(120)`, `email citext UNIQUE`, `password_hash text`, `created_at`, `updated_at` |
| `sessions` | `id uuid PK` (= `sid`), `user_id FK`, `created_at`, `last_used_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at null`, `revoked_reason varchar(20) null` (`LOGOUT`, `REFRESH_REUSE`). Índice em `(revoked_at)` para a reidratação. |
| `refresh_tokens` | `id uuid PK`, `session_id FK`, `token_hash char(64) UNIQUE`, `issued_at`, `expires_at`, `used_at null`, `replaced_by_id uuid null` |
| `outbox` | igual a `video.outbox` |

### video
| Tabela | Colunas |
|---|---|
| `videos` | `id uuid PK`, `user_id uuid`, `file_name varchar(255)`, `content_type varchar(40)`, `size_bytes bigint`, `fps numeric(2,1)`, `status varchar(20) CHECK`, `input_key text`, `output_key text null`, `frame_count int null`, `zip_size_bytes bigint null`, `failure_code varchar(30) null`, `failure_message varchar(500) null`, `correlation_id uuid`, `created_at`, `updated_at`, `queued_at`, `started_at`, `completed_at`. Índices `(user_id, created_at DESC, id DESC)` e `(status, updated_at)`. |
| `outbox` | `id uuid PK`, `aggregate_id uuid`, `type varchar(60)`, `destination varchar(120)`, `payload jsonb` (envelope completo), `created_at`, `published_at null`, `attempts int default 0`, `last_error text null`. Índice parcial `WHERE published_at IS NULL`. |
| `inbox` | `message_id uuid PK`, `type varchar(60)`, `processed_at` |

### notification
| Tabela | Colunas |
|---|---|
| `user_contacts` | `user_id uuid PK`, `email citext`, `name varchar(120)`, `updated_at` |
| `inbox` | `message_id uuid PK`, `type`, `processed_at` |
| `notifications` | `id uuid PK`, `user_id`, `video_id`, `channel varchar(10)` (`EMAIL`), `status varchar(10)` (`SENT`, `FAILED`), `provider_message_id null`, `created_at` (auditoria) |

---

## B5. Pipeline do worker (sem banco)
1. Fazer long-poll no SQS (20 s, 1 mensagem). Roda **1 loop por pod** (D34: 1 job por pod, 1 CPU garantida).
2. Validar o envelope (zod). Se for inválido, logar e apagar, com a métrica `messages_invalid_total`.
3. Checar idempotência: se `HeadObject(outputKey)` existir, republicar `video.processed` com os metadados do objeto e apagar a mensagem.
4. Publicar `video.processing`.
5. Baixar `inputKey` para `/work/{videoId}/input.{ext}`. O `/work` é um `emptyDir` com `sizeLimit: 3Gi`. Se o objeto não existir, falhar com `INPUT_NOT_FOUND`.
6. Rodar `ffprobe` (spawn, timeout de 30 s) para obter stream de vídeo e duração. Se não houver stream de vídeo, falhar com `INVALID_VIDEO`. Se `ceil(duração × fps) > 3600`, falhar com `VIDEO_TOO_LONG` (T04).
7. Abrir um zip em streaming (`archiver`, nível 0, porque o PNG já vem comprimido) ligado a um upload multipart (`@aws-sdk/lib-storage`) em `outputKey`.
8. Para cada janela de 60 s (T03):
   - rodar `spawn('ffmpeg', ['-hide_banner','-loglevel','error','-ss',start,'-t','60','-i',input,'-vf',`fps=${fps}`,'-start_number',offset,'-y',`${dir}/frame_%05d.png`])`;
   - adicionar os PNGs ao zip e apagá-los depois do evento `entry`.

   Os argumentos vão sempre em array, **nunca em shell**.
9. Se o total de frames for 0, falhar com `NO_FRAMES`.
10. Finalizar o zip e publicar `video.processed`. Apagar o `inputKey` (o lifecycle de 1 dia é o fallback) e apagar a mensagem.
11. Em `finally`: remover `/work/{videoId}` e parar o heartbeat.

O timeout global de 15 min mata o processo ffmpeg (`SIGKILL`) e trata o caso como erro transitório (`TIMEOUT`).

**Graceful shutdown:** no `SIGTERM`, o worker para de fazer poll, espera os jobs em andamento até `terminationGracePeriodSeconds: 900` e só então encerra.

---

## B6. Outbox relay (video-service e auth-service)
- É um loop no próprio processo, que roda a cada 1 s. Também é disparado logo depois do commit, como otimização.
- Fluxo: abre a transação, executa `SELECT … FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`, publica cada item (SQS `SendMessage` ou SNS `Publish`), faz `UPDATE published_at = now()` e dá commit.
- Em erro: `attempts++` e `last_error`. O item fica para o próximo ciclo.
- `SKIP LOCKED` permite várias réplicas sem publicação duplicada. Se houver duplicata residual (crash entre publicar e commit), a inbox dos consumidores absorve.
- Métricas: `outbox_pending_total` e `outbox_oldest_pending_seconds`.

### Cache e Redis (video-service e auth-service)
| Uso | Chave | TTL | Falha |
|---|---|---|---|
| Revogação | `revoked:sid:{sid}` | 900 s | fail-closed (503) |
| Rate limit de login | `rl:login:email:{sha256(email)}` e `rl:login:ip:{ip}` | 60 s | fail-closed |
| Rate limit de refresh | `rl:refresh:ip:{ip}` | 60 s | fail-closed |
| Versão da lista | `videos:ver:{userId}` (INCR a cada mudança de status) | — | — |
| Cache da listagem | `videos:list:{userId}:{ver}:{cursor}:{limit}` | 30 s | fail-open (lê do Postgres) |

---

## B7. Layout do S3
| Item | Valor |
|---|---|
| Bucket | `fiapx-<env>-videos-<accountId>`. No ambiente local é `fiapx-local-videos`. |
| Entrada | `raw/{userId}/{videoId}.{ext}` |
| Saída | `output/{userId}/{videoId}/frames.zip` |
| Proteção | Block Public Access, SSE-S3, `aws:SecureTransport` obrigatório, versionamento desligado |
| Lifecycle | `raw/` expira em 1 dia, `output/` em 7 dias. Multipart incompleto é abortado em 1 dia. |
| URL de download | Nome sugerido `{nome-original-sem-ext}_frames.zip` |
| **Pegadinha no ambiente local** | Assinar as URLs com `S3_PUBLIC_ENDPOINT=http://localhost:4566`, que é o endereço acessível pelo Postman. As operações internas usam `S3_ENDPOINT=http://localstack:4566` e `forcePathStyle: true`. |

---

## B8. Nomes de recursos (`<env>` = `local` | `homolog`, região `us-east-1`)
| Recurso | Nome | Parâmetros |
|---|---|---|
| Fila de comando | `fiapx-<env>-video-process` + `-dlq` | VT 120 s, retenção de 4 dias, `maxReceiveCount` 3, DLQ com retenção de 14 dias |
| Fila de status | `fiapx-<env>-video-status-updates` + `-dlq` | VT 30 s, `maxReceiveCount` 5 |
| Fila de notificação | `fiapx-<env>-notifications` + `-dlq` | VT 30 s, `maxReceiveCount` 5 |
| Fila de contatos | `fiapx-<env>-user-contacts` + `-dlq` | VT 30 s, `maxReceiveCount` 5 |
| Tópicos | `fiapx-<env>-video-events` e `fiapx-<env>-user-events` | SSE com KMS gerenciada |
| Namespace K8s | `fiapx` (apps), `observability`, `keda` | — |
| ECR | `fiapx-auth-service`, `fiapx-video-service`, `fiapx-video-worker`, `fiapx-notification-service` | scan on push, imutável |
| Secrets Manager | `fiapx/<env>/<svc>` e `fiapx/<env>/jwt-signing-key` | — |
| State do Terraform | bucket `fiapx-tfstate-<accountId>`, tabela de lock `fiapx-tflock`, keys `data/<env>` e `platform/<env>` | — |
| Tags | `Project=fiapx`, `Env=<env>`, `ManagedBy=terraform` | usadas no Budget (D22) |

---

## B9. Ferramentas e bibliotecas
| Área | Escolha |
|---|---|
| Runtime | Node 22 LTS, TypeScript 5 (`strict`), NestJS 11, yarn 4 via corepack |
| Configuração | `@nestjs/config` + schema zod. A aplicação **não sobe** se a configuração for inválida. |
| Persistência | Prisma 6 (`?schema=<svc>` na URL) |
| Auth | `jose` (assinatura, verificação, JWKS), `argon2` (argon2id, m=19 MiB, t=2, p=1), lista de senhas comuns (top 10k) embutida |
| Redis | `ioredis` (TLS em homolog) |
| AWS | SDK v3: `client-s3`, `s3-presigned-post`, `s3-request-presigner`, `lib-storage`, `client-sqs`, `client-sns`, `client-sesv2` |
| E-mail local | `nodemailer` SMTP → Mailpit. A porta `EmailSender` tem adapters SES e SMTP, escolhidos por `EMAIL_PROVIDER`. |
| Zip e vídeo | `archiver`; `ffmpeg`/`ffprobe` do Debian bookworm, chamados via `child_process.spawn` |
| Logs | `nestjs-pino` (JSON, redaction de `password`, `refreshToken`, `authorization` e `email`) |
| Métricas | `prom-client` via `@willsoto/nestjs-prometheus` |
| Traces | `@opentelemetry/sdk-node` + auto-instrumentations (http, pg, ioredis, aws-sdk) + OTLP HTTP. A propagação manual de `traceparent` acontece no envelope. |
| Testes | Jest + ts-jest, supertest, Testcontainers (`postgresql`, `redis`, `localstack`), `@cucumber/cucumber` (pt-BR), k6 |
| Qualidade | ESLint (flat) + Prettier, dependency-cruiser (regras de camada do modelo), SonarCloud |
| Imagens | `node:22-bookworm-slim` multi-stage, uid 10001, `readOnlyRootFilesystem` + `emptyDir` em `/tmp` e `/work` |

### Estrutura de pastas (igual nos 4 serviços)
```
src/
  domain/          entidades, value objects, máquina de estados, erros, portas (interfaces)
  application/     casos de uso, DTOs de entrada e saída
  infrastructure/  prisma/, messaging/ (sqs, sns, outbox), storage/ (s3), cache/ (redis),
                   auth/ (jwks), email/, observability/, config/
  interfaces/      http/ (controllers, guards, filters), consumers/ (sqs)
  main.ts  app.module.ts
test/integration/  *.int-spec.ts (Testcontainers)
features/          *.feature + steps (só no video-service: e2e de todo o sistema)
prisma/            schema.prisma + migrations/
k8s/               manifests do serviço
```
Regras do dependency-cruiser:
- `domain` não importa nada de fora dele;
- `application` importa só `domain`;
- `infrastructure` e `interfaces` podem importar `application` e `domain`.

O código é escrito em inglês. Documentação e mensagens ao usuário são em pt-BR.

---

## B10. Portas, saúde e variáveis
| Serviço | Porta no container | Porta no host (compose) | NodePort (homolog) |
|---|---|---|---|
| auth-service | 3000 | 3001 | 30081 |
| video-service | 3000 | 3002 | 30082 |
| video-worker | 3000 (só health e métricas) | 3003 | — |
| notification-service | 3000 (só health e métricas) | 3004 | — |
| Grafana / Prometheus / Mailpit / LocalStack | — | 3000 / 9090 / 8025 / 4566 | — |

**Variáveis comuns:** `NODE_ENV`, `APP_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `REDIS_URL`, `AWS_REGION`, `AWS_ENDPOINT` (somente no local), `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWKS_URL`.

**Variáveis específicas:**
- auth: `JWT_PRIVATE_KEY_PEM`, `JWT_KID`, `ACCESS_TTL=900`, `REFRESH_IDLE_TTL=3600`, `SESSION_ABSOLUTE_TTL=28800`, `USER_EVENTS_TOPIC_ARN`
- video: `S3_BUCKET`, `S3_PUBLIC_ENDPOINT`, `VIDEO_PROCESS_QUEUE_URL`, `VIDEO_STATUS_QUEUE_URL`
- worker: `S3_BUCKET`, `VIDEO_PROCESS_QUEUE_URL`, `VIDEO_EVENTS_TOPIC_ARN`, `WORKER_CONCURRENCY=1`, `MAX_FRAMES=3600`, `PROCESS_TIMEOUT_MS=900000`
- notification: `NOTIFICATIONS_QUEUE_URL`, `USER_CONTACTS_QUEUE_URL`, `EMAIL_PROVIDER=ses|smtp`, `EMAIL_FROM`, `SMTP_HOST`

Cada repo traz um `.env.example` só com valores fictícios. Nenhum `.env` é versionado.

---

## B11. Pacote de contratos
- Fica em `fiapx-video-service/packages/contracts` (yarn workspace) e é publicado como `@dinhogt/fiapx-contracts` no GitHub Packages quando existe uma tag `contracts-vX.Y.Z`.
- Conteúdo: tipos e schemas zod do envelope e das 5 mensagens, nomes de filas e tópicos (por env) e o enum `failureCode`.
- Consumidores: os outros 3 repos dependem dele via `.npmrc` (`@dinhogt:registry=https://npm.pkg.github.com`).
  - No CI: `GITHUB_TOKEN` com `packages: read`. O pacote precisa dar acesso de leitura aos repos consumidores nas configurações do GitHub.
  - Localmente: um PAT com `read:packages` em `NPM_TOKEN`, documentado no README.
- Mudança que quebra compatibilidade exige `version: 2` no envelope e consumidores aceitando as duas versões durante a transição.

## B12. Ambiente local (compose)
- O arquivo é `fiapx-video-service/docker-compose.yml`. Ele pressupõe os clones irmãos em `fiapx-repos/` e faz build de `../fiapx-auth-service` e dos demais.
- O CI roda o mesmo compose pelo workflow `e2e.yml`, que faz checkout dos repos irmãos (E-01).
- Serviços:
  - **Infra:** `postgres:16` (com `db/init.sql`), `redis:7` (`--appendonly yes`, volume, D24), `localstack:4` (s3, sqs, sns; `localstack/init/ready.d/10-resources.sh` cria todos os recursos de B8 com `<env>=local`), `mailpit`.
  - **Observabilidade:** `alloy`, `prometheus`, `loki`, `tempo` e `grafana`, com datasources e dashboards provisionados de `observability/`.
  - **Migrações:** `migrate-auth`, `migrate-video` e `migrate-notification`, que rodam e saem antes das aplicações.
  - **Aplicações:** os 4 serviços, com healthcheck e `depends_on: condition: service_healthy`.
- Scripts:
  - `make up` / `make down`;
  - `make e2e` roda o Cucumber contra a stack;
  - `make seed-video` coloca o vídeo de fixture em `test/fixtures/sample-5s.mp4` (cerca de 300 KB, versionado).

## B13. Exposição na AWS
- Topologia: API Gateway HTTP API → VPC Link → NLB interno (T05, target type `instance` com ASG attachment).
  - Listener 8081 vai para o NodePort 30081 (auth).
  - Listener 8082 vai para o NodePort 30082 (video).
- **Rotas sem authorizer:** `POST /auth/register|login|refresh`, `GET /.well-known/*`.
- **Rotas com authorizer JWT** (issuer = URL do gateway (T06), audience `fiapx-api`): `POST /auth/logout`, `GET /auth/me`, `ANY /videos`, `ANY /videos/{proxy+}`.
- Throttling: burst 100 / rate 50 no stage, e burst 10 / rate 5 em `POST /auth/login`. Access logs em JSON no CloudWatch com retenção de 7 dias (o único uso do CloudWatch).
- O worker e o notification não têm rota pública.

## B14. Segredos e IAM
| Segredo | Origem | Consumidor |
|---|---|---|
| Chave de assinatura RS256 | `tls_private_key` no Terraform, guardada em `fiapx/<env>/jwt-signing-key` (o state é criptografado) | só o auth |
| Senha master do RDS | `manage_master_user_password` (Secrets Manager nativo) | Job `db-init` |
| Senhas `auth_svc`, `video_svc`, `notification_svc` | `random_password` → `fiapx/<env>/<svc>` | o próprio serviço |
| AUTH token do ElastiCache | `random_password` → `fiapx/<env>/redis` | auth e video |

**Injeção:** o passo de CD lê o Secrets Manager e faz `kubectl create secret … --dry-run=client -o yaml | kubectl apply -f -`, no mesmo padrão do `deploy-aws.sh` do modelo. Não há operador extra.

**IRSA (mínimo privilégio, por serviço):**
| Serviço | Permissões |
|---|---|
| auth | `sns:Publish` em user-events |
| video | `s3:PutObject`/`GetObject` em `raw/*` e `output/*` (assinatura de URL), `s3:HeadObject` (feito com `s3:GetObject`) em `raw/*`, `sqs:SendMessage` em video-process, `sqs:Receive/Delete` em video-status-updates |
| worker | `s3:GetObject`/`DeleteObject` em `raw/*`, `s3:PutObject`/`GetObject` em `output/*`, `sqs:Receive/Delete/ChangeMessageVisibility` em video-process, `sns:Publish` em video-events |
| notification | `sqs:Receive/Delete` em notifications e user-contacts, `ses:SendEmail` no remetente verificado |

O CI do GitHub usa OIDC com uma role por repo, como no ADR-009 do modelo.

## B15. Gates de CI (por repo de serviço)
| Gatilho | Jobs (um falhou, o pipeline para) |
|---|---|
| PR para `develop` ou `master` | `security-gate` (gitleaks + bloqueio de `.env`, tfstate e chaves) → `lint` (eslint, prettier `--check`, depcruise) → `test` (unit + integration, cobertura **≥ 80%** em linhas, branches, funções e statements) → `sonar` (quality gate wait) → `audit` (`yarn npm audit --severity high`) → `build` → `image` (docker build + Trivy: falha em CRITICAL/HIGH com correção disponível) |
| Push em `develop` | Tudo do PR, mais: push no ECR (`sha-<short>` e `develop`) → `migrate` Job → `kubectl apply` → `rollout status --timeout=180s` → se falhar, `rollout undo` e o job falha → smoke (`/health/ready` e uma chamada autenticada) |
| Push em `master` | Tudo do PR, mais: cria a tag SemVer, retag da imagem para `vX.Y.Z` e GitHub Release. **Sem deploy** (D20). |
| `fiapx-infra`, PR | `terraform fmt -check`, `validate`, `tflint`, `checkov` (soft-fail), `plan` (role OIDC só leitura) com comentário no PR |
| `fiapx-infra`, push em `develop` | `apply` em homolog com o environment `homolog` (aprovação manual) e a variável `ENABLE_OIDC_CD=true` |
| `fiapx-infra`, manual | Workflow `destroy` (`workflow_dispatch`, confirmação digitada) para cumprir a D22 |

## B16. Convenções
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`, `refactor:`).
- **Branches:** `feature/<EP-xx>-<slug>` → PR para `develop` → PR de release para `master`. O `master` é protegido: exige PR, checks verdes e histórico linear.
- **PR template:** checklist com testes, cobertura, docs e ADR atualizados, sem segredos, AC-xx atendido.
- **Versionamento:** SemVer por repo. `docs/release-notes.md` é atualizado a cada release.
- **README** de cada repo: o que é, como rodar local, variáveis, testes e links para a documentação canônica.
- **Documentação canônica:** em `fiapx-video-service/docs/` (D12/D23). Os outros repos linkam para ela.

---

## B17. Ajustes da revisão crítica ([06-revisao-critica.md](06-revisao-critica.md))
Estes ajustes têm precedência sobre as seções anteriores em caso de conflito.

| ID | Regra |
|---|---|
| S-01 | O API Gateway aplica `overwrite:header.x-client-ip = $context.identity.sourceIp` em todas as rotas. O rate limit usa `x-client-ip` só quando `TRUST_GATEWAY_IP=true`; caso contrário, usa o IP do socket. |
| S-02 | `Content-Disposition: attachment; filename="<ascii-sanitizado>_frames.zip"; filename*=UTF-8''<percent-encoded>`. O sanitizado usa `[A-Za-z0-9._-]`, com no máximo 100 caracteres e fallback `video`. |
| S-03 | EKS com `encryption_config` (resources `secrets`) e chave KMS `alias/fiapx-<env>-eks` |
| S-04 | RDS parameter group `rds.force_ssl=1`. `DATABASE_URL` com `sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem` (bundle copiado na imagem). No ambiente local, `sslmode=disable`. |
| S-05 | O SG dos nós libera TCP 30081–30082 só a partir de `var.vpc_cidr` |
| S-06 | `db/init.sql` usa `CREATE ROLE auth_svc LOGIN PASSWORD :'auth_password'` (e equivalentes). É executado por `psql -v auth_password=$AUTH_DB_PASSWORD … -f init.sql`. Nenhuma senha fica no arquivo. |
| S-08 | Grafana sem Service exposto. Acesso por `kubectl -n observability port-forward svc/grafana 3000:80`. |
| P-01 / D34 | Dois node groups gerenciados. **`apps`**: `t3.medium` on-demand, 2–3 nós. **`worker`**: spot com `[c7i.xlarge, c6i.xlarge, m6i.xlarge]`, 1–3 nós, disco de 50 GB, label `workload=worker`, taint `workload=worker:NoSchedule`. O Deployment do worker tem toleration e nodeSelector, requests `cpu: 1, memory: 1.5Gi` e limits `cpu: 2, memory: 3Gi`. KEDA: `minReplicaCount: 1`, `maxReplicaCount: 9`, alvo de `1` mensagem visível por pod. O EKS faz drain dos nós spot em rebalance. |
| P-02 | `DATABASE_URL` com `connection_limit=5` (auth e video) e `3` (notification). Alerta `PostgresConnectionsHigh` acima de 70. |
| P-03 | O alerta `ApiLatencyP95` (300 ms) exclui `/auth/login` e `/auth/register`, que têm alerta próprio de 800 ms |
| E-01 | `fiapx-video-service/.github/workflows/e2e.yml`: checkout dos 4 repos em `../`, `docker compose up -d --wait` e `yarn e2e` (Cucumber). Roda em PR para `develop` e por `workflow_dispatch`. |
| E-02 | `fiapx-infra/.github/workflows/db-init.yml`: depois do apply de `platform`, cria o ConfigMap com o `init.sql`, o Secret com as senhas (do Secrets Manager) e o Job `db-init` (`postgres:16`). É idempotente (`CREATE … IF NOT EXISTS` / `DO $$` blocks). |
| E-03 | O download devolve 410 `problem+json` quando `now() > completedAt + 7 dias` |
| E-04 | Housekeeping a cada hora: `DELETE outbox WHERE published_at < now() - 7 days` e `DELETE inbox WHERE processed_at < now() - 14 days` |
| E-05 | Os jobs periódicos (expiração, housekeeping) usam `pg_try_advisory_lock(<hash do nome do job>)`. Se não conseguirem o lock, pulam o ciclo. |
| E-06 | O CI do worker roda `sudo apt-get install -y ffmpeg` antes de `yarn test` |
| KEDA | O `ScaledObject` usa `podIdentity: aws` com `identityOwner: workload`, então a IRSA do worker também recebe `sqs:GetQueueAttributes` em `video-process` |
| DB | Como o Job de migrate roda `npx prisma migrate deploy`, o `prisma` CLI precisa estar em `dependencies` (não em devDependencies) nos serviços com banco |
