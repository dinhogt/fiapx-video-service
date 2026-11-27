# Roteiro do vídeo (≤ 10 minutos)

O enunciado pede que o vídeo mostre a documentação, a arquitetura escolhida e o projeto funcionando.

**Ambiente de gravação:** homolog AWS (preferencial) ou o ambiente local como plano B. O roteiro é o mesmo nos dois, só muda o ambiente do Postman.

**Ensaio obrigatório:** cronometrar duas passadas completas antes de gravar.

**Itens que não podem ser cortados**, mesmo se o tempo apertar: bloco 4 (fluxo feliz), bloco 5 (falha + notificação) e bloco 6 (pico).

## Preparação (antes de gravar)
- [ ] Homolog no ar: `kubectl get pods -n fiapx` todos Ready, 1 worker e nós `apps` ×2 + `worker` ×1.
- [ ] Usuário da demo já cadastrado, com e-mail verificado no SES.
- [ ] Postman no ambiente `homolog`, com os arquivos `sample-30s.mp4` e `corrupted.mp4` à mão.
- [ ] Grafana via `port-forward` no dashboard "FIAP X: jornada do vídeo", intervalo "Last 15 minutes".
- [ ] Abas abertas:
  - GitHub (`fiapx-video-service`: README, Actions, docs);
  - SonarCloud;
  - `docs/architecture/diagrams.md` renderizado.
- [ ] Script k6 pronto: `k6 run -e BASE_URL=… test/load/peak.js`.

## Blocos
| # | Tempo | Bloco | O que mostrar | Fala-chave |
|---|---|---|---|---|
| 1 | 0:00–0:45 | Contexto | Enunciado e limitações do projeto base (síncrono, disco local, sem auth) | "Transformamos um monolito síncrono em uma plataforma assíncrona, escalável e segura." |
| 2 | 0:45–2:30 | Arquitetura | Diagrama de containers (C4-2): 4 serviços, API Gateway, SQS/SNS, S3, RDS, Valkey, KEDA. Citar ADR-001, 003, 004 e 009. | "O worker escala pela fila. O pico vira backlog, e não erro." |
| 3 | 2:30–3:30 | Documentação e qualidade | Pasta `docs/` (ADRs, threat model, requisitos → AC), Actions verdes (security-gate, testes ≥ 80%, Sonar, Trivy), cobertura no Sonar | "Cada requisito tem critério de aceite e evidência." |
| 4 | 3:30–5:45 | **Fluxo feliz** | Postman: register → login → `POST /videos` → upload presigned → confirm (202) → `GET /videos` (QUEUED → PROCESSING → COMPLETED) → download → abrir o zip com os frames. Em paralelo, mostrar o Grafana. | "Upload direto ao S3. A API só assina." |
| 5 | 5:45–7:00 | **Falha + notificação** | Enviar `corrupted.mp4` → status FAILED com `failureCode` → e-mail recebido. Mostrar o trace no Tempo (API → fila → worker → notification) a partir do log no Loki. | "Falha permanente não tem retry. Usuário avisado. Tudo rastreável por correlationId." |
| 6 | 7:00–8:45 | **Pico e escala** | Rodar o k6 (50 uploads). No Grafana: a fila sobe, o KEDA aumenta os workers, o Cluster Autoscaler adiciona nó spot, a fila drena e 0 fica em QUEUED. | "Nenhuma requisição perdida: outbox + fila durável + idempotência." |
| 7 | 8:45–9:30 | Segurança | Mostrar rapidamente: 401 sem token, 404 em vídeo de outro usuário, refresh reutilizado revoga a sessão, gitleaks e Trivy no CI | "Sessão de 15 min com refresh rotativo e revogação imediata." |
| 8 | 9:30–10:00 | Encerramento | Links dos repos, custo (homolog efêmera, Budget de 50 USD) | — |

## Plano de contingência
- **Homolog fora do ar:** gravar no ambiente local (`make up`). O Grafana local tem o mesmo dashboard. No bloco 6, mostrar o worker escalando via `docker compose up --scale video-worker=4` e explicar o KEDA pelo manifest.
- **O nó spot demora a subir no bloco 6:** narrar o backlog na fila (é o comportamento esperado) e cortar para o momento em que ela drena.
