# Diagramas: FIAP X Video Processor

Os diagramas estão em Mermaid e são renderizados pelo GitHub. Para o vídeo, devem ser exportados como PNG para `docs/delivery/assets/`.

## 1. Contexto (C4 nível 1)
```mermaid
flowchart LR
  user([Usuário / investidor<br/>via Postman])
  subgraph fiapx[FIAP X Video Processor]
    sys[Sistema de processamento de vídeos]
  end
  ses[(Amazon SES<br/>e-mail)]
  gh[GitHub Actions<br/>CI/CD]
  user -- "HTTPS: cadastro, login, upload, status, download" --> sys
  sys -- "e-mail de falha" --> ses
  ses -- "notificação" --> user
  gh -- "deploy (OIDC)" --> sys
```

## 2. Containers (C4 nível 2)
```mermaid
flowchart TB
  client([Cliente Postman])
  subgraph edge[Borda AWS]
    apigw[API Gateway HTTP<br/>JWT authorizer + throttling]
    nlb[NLB interno<br/>NodePort 30081/30082]
  end
  subgraph eks[EKS: namespace fiapx]
    auth[auth-service<br/>NestJS]
    video[video-service<br/>NestJS]
    worker[video-worker<br/>NestJS + ffmpeg<br/>KEDA 1–9 · pool spot]
    notif[notification-service<br/>NestJS]
  end
  subgraph data[Dados gerenciados]
    rds[(RDS PostgreSQL<br/>schemas auth / video / notification)]
    redis[(ElastiCache Valkey<br/>Multi-AZ)]
    s3[(S3<br/>raw/ e output/)]
  end
  subgraph msg[Mensageria]
    qproc[[SQS video-process + DLQ]]
    tvid{{SNS video-events}}
    quser{{SNS user-events}}
    qstat[[SQS video-status-updates + DLQ]]
    qnot[[SQS notifications + DLQ]]
    qcont[[SQS user-contacts + DLQ]]
  end
  ses[(SES)]
  obs[Alloy → Prometheus / Loki / Tempo → Grafana]

  client --> apigw --> nlb
  nlb --> auth
  nlb --> video
  client -. "presigned POST / GET" .-> s3
  auth --> rds
  auth --> redis
  auth -- outbox --> quser
  video --> rds
  video --> redis
  video -- "assina URLs, HEAD" --> s3
  video -- outbox --> qproc
  qproc --> worker
  worker --> s3
  worker --> tvid
  tvid --> qstat --> video
  tvid -- "filtro: video.failed" --> qnot --> notif
  quser --> qcont --> notif
  notif --> rds
  notif --> ses
  eks -.-> obs
```

## 3. Sequência 1: upload, processamento e download (caminho feliz)
```mermaid
sequenceDiagram
  autonumber
  actor U as Cliente
  participant G as API Gateway
  participant V as video-service
  participant DB as Postgres (video)
  participant S3
  participant Q as SQS video-process
  participant W as video-worker
  participant T as SNS video-events
  U->>G: POST /videos {fileName, sizeBytes, contentType, fps}
  G->>V: (JWT válido)
  V->>V: valida JWT, revogação (Redis), entrada
  V->>DB: INSERT videos (PENDING_UPLOAD)
  V-->>U: 201 {videoId, upload: presigned POST}
  U->>S3: POST form-data (≤ 500 MB)
  U->>G: POST /videos/{id}/confirm
  G->>V: confirm
  V->>S3: HeadObject(raw/...)
  V->>DB: TX: status=QUEUED + INSERT outbox
  V-->>U: 202 {status: QUEUED}
  loop relay a cada 1 s
    V->>DB: SELECT outbox FOR UPDATE SKIP LOCKED
    V->>Q: SendMessage(video.process)
    V->>DB: published_at = now()
  end
  W->>Q: ReceiveMessage (long poll)
  W->>T: video.processing
  W->>S3: GetObject raw
  W->>W: ffprobe + janelas ffmpeg → zip streaming
  W->>S3: multipart upload output/.../frames.zip
  W->>T: video.processed
  W->>Q: DeleteMessage
  T-->>V: (via SQS video-status-updates)
  V->>DB: TX: inbox + status=COMPLETED; INCR videos:ver
  U->>G: GET /videos
  V-->>U: 200 [ {status: COMPLETED, frameCount} ]
  U->>G: GET /videos/{id}/download
  V-->>U: 200 {url presigned GET 5 min}
  U->>S3: GET frames.zip
```

## 4. Sequência 2: login, refresh, reuso e logout
```mermaid
sequenceDiagram
  autonumber
  actor U as Cliente
  participant A as auth-service
  participant DB as Postgres (auth)
  participant R as Redis
  U->>A: POST /auth/login
  A->>R: rate limit (fail-closed)
  A->>DB: busca usuário, verifica argon2id
  A->>DB: INSERT session (sid) + refresh_token (hash)
  A-->>U: {accessToken 15 min, refreshToken}
  U->>A: POST /auth/refresh {rt1}
  A->>DB: rt1 válido e não usado? marca used, cria rt2
  A-->>U: {access novo, rt2}
  Note over U,A: atacante reapresenta rt1
  U->>A: POST /auth/refresh {rt1}
  A->>DB: rt1 já usado → sessions.revoked_at (REFRESH_REUSE)
  A->>R: SET revoked:sid:{sid} EX 900
  A-->>U: 401 (sessão revogada; log de segurança)
  U->>A: POST /auth/logout (Bearer)
  A->>DB: revoked_at = now() (LOGOUT)
  A->>R: SET revoked:sid:{sid} EX 900
  A-->>U: 204
  loop a cada 60 s e no boot
    A->>DB: sids revogados nos últimos 15 min
    A->>R: reidrata revoked:sid:*
  end
```

## 5. Sequência 3: falha e notificação
```mermaid
sequenceDiagram
  autonumber
  participant Q as SQS video-process
  participant W as video-worker
  participant T as SNS video-events
  participant V as video-service
  participant N as notification-service
  participant SES
  W->>Q: ReceiveMessage
  alt erro permanente (INVALID_VIDEO, VIDEO_TOO_LONG, NO_FRAMES, INPUT_NOT_FOUND)
    W->>T: video.failed (sem retry)
    W->>Q: DeleteMessage
  else erro transitório e ReceiveCount < 3
    W--xQ: não apaga → reaparece após o VT
  else erro transitório e ReceiveCount ≥ 3
    W->>T: video.failed (TIMEOUT / PROCESSING_ERROR)
    W->>Q: DeleteMessage
  else crash sem publicar (OOM)
    Q->>Q: após 3 recebimentos → DLQ → alerta DLQNotEmpty
  end
  T-->>V: video-status-updates → status=FAILED
  T-->>N: notifications (filtro video.failed)
  N->>N: inbox + busca user_contacts
  N->>SES: e-mail pt-BR
```

## 6. Estados do vídeo
```mermaid
stateDiagram-v2
  [*] --> PENDING_UPLOAD: POST /videos
  PENDING_UPLOAD --> QUEUED: confirm (objeto existe)
  PENDING_UPLOAD --> EXPIRED: 24 h sem confirm
  QUEUED --> PROCESSING: video.processing
  QUEUED --> COMPLETED: video.processed (fora de ordem)
  QUEUED --> FAILED: video.failed
  PROCESSING --> COMPLETED: video.processed
  PROCESSING --> FAILED: video.failed
  COMPLETED --> [*]
  FAILED --> [*]
  EXPIRED --> [*]
```
As transições não listadas, como um `processing` depois de `COMPLETED`, são ignoradas e ficam registradas na inbox.

## 7. Implantação (homolog)
```mermaid
flowchart TB
  subgraph aws[AWS us-east-1 — VPC 10.0.0.0/16]
    subgraph pub[Subnets públicas 2 AZ]
      nat[NAT Gateway ×1]
    end
    subgraph priv[Subnets privadas 2 AZ]
      subgraph eks[EKS 1.34 — pools: apps t3.medium 2–3 · worker spot xlarge 1–3]
        ns1[ns fiapx: auth ×2–5, video ×2–5, notification ×1–2, Jobs migrate — pool apps<br/>worker ×1–9 — pool worker spot]
        ns2[ns observability: Alloy DS, Prometheus, Loki, Tempo, Grafana]
        ns3[ns keda + cluster-autoscaler]
      end
      nlb[NLB interno]
      rds[(RDS Postgres t4g.micro)]
      ec[(ElastiCache Valkey t4g.micro ×2)]
    end
  end
  apigw[API Gateway HTTP + VPC Link] --> nlb --> eks
  eks --> rds
  eks --> ec
  eks --> s3[(S3)]
  eks --> sqs[(SQS/SNS)]
  eks --> ses[(SES)]
  eks -- "ECR pull via NAT" --> ecr[(ECR)]
  gha[GitHub Actions OIDC] --> ecr
  gha --> eks
```
