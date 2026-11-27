# Requisitos: FIAP X Video Processor

| Campo | Valor |
|---|---|
| Escopo | Entregas 0–1: requisitos e desenho da nova versão |
| Baseline | `projeto-fiapx` (monolito Go síncrono) é só referência funcional; nenhum código é reaproveitado |
| Meta | 4 microsserviços NestJS, processamento assíncrono e escalável, entrega em homolog AWS + ambiente local |
| Status | **Revisado em 2026-11-20.** Parâmetros confirmados (D13–D17, D34). |

## Objetivo
Permitir que um usuário autenticado envie um ou mais vídeos, acompanhe o processamento e baixe um `.zip` com os frames extraídos. O sistema não pode perder requisições em picos e deve notificar o usuário quando o processamento falhar.

## Fluxos de referência
| Fluxo | Descrição |
|---|---|
| F1 | Cadastro e login com usuário (e-mail) e senha |
| F2 | Upload: solicitar o upload, enviar o vídeo ao storage e confirmar o envio, o que o coloca na fila |
| F3 | Processamento concorrente: extrair frames e gerar o zip |
| F4 | Listagem de status dos vídeos do usuário |
| F5 | Download do zip |
| F6 | Falha no processamento e notificação ao usuário |
| F7 | Pico de carga sem perda de requisições |
| F8 | Isolamento entre usuários: ninguém vê nem baixa vídeos de outro usuário |
| F9 | Rastreabilidade ponta a ponta (logs, métricas, traces) |
| F10 | Entrega contínua com qualidade (testes, cobertura, scan, deploy, rollback) |

## Requisitos funcionais
| ID | Requisito | Prioridade | Fluxos | Origem (enunciado) |
|---|---|---|---|---|
| RF-01 | O usuário se cadastra com nome, e-mail e senha. O e-mail é único. | Must | F1 | Protegido por usuário e senha |
| RF-02 | O usuário faz login com e-mail e senha e recebe um **access token** JWT RS256 (15 min) e um **refresh token** opaco (60 min de inatividade, renovado a cada uso). | Must | F1 | Protegido por usuário e senha |
| RF-02a | `POST /auth/refresh` troca o refresh token por um novo par. A troca rotaciona o refresh (uso único) e mantém a sessão ativa enquanto houver uso, até o limite absoluto de 8 h. | Must | F1 | Protegido por usuário e senha |
| RF-02b | `POST /auth/logout` revoga a sessão (`sid`). O access token já emitido deixa de ser aceito imediatamente pelos serviços. | Must | F1 | Protegido por usuário e senha |
| RF-03 | Todos os endpoints de vídeo exigem um JWT válido. | Must | F1, F8 | Protegido por usuário e senha |
| RF-04 | O usuário solicita um upload informando o nome do arquivo, o tamanho, o content-type e o `fps` (opcional). Recebe o `videoId` e uma URL pré-assinada válida por 15 minutos. | Must | F2 | Enviar vídeo |
| RF-05 | Formatos aceitos: mp4, mov, avi, mkv e webm. Tamanho máximo de 500 MB. `fps` entre 0.1 e 5, com padrão 1. | Must | F2 | Enviar vídeo |
| RF-06 | Ao confirmar o upload, o sistema verifica o objeto no storage e enfileira o processamento de forma durável. | Must | F2, F7 | Não perder requisição |
| RF-07 | Vários vídeos, do mesmo usuário ou de usuários diferentes, são processados em paralelo. | Must | F3 | Processar mais de um vídeo ao mesmo tempo |
| RF-08 | O worker extrai os frames na taxa pedida, gera o zip e o guarda no storage. | Must | F3 | Retornar imagens em .zip |
| RF-09 | O usuário lista os seus vídeos (paginado), com status, data, quantidade de frames e motivo da falha quando houver. | Must | F4 | Listagem de status |
| RF-10 | O usuário consulta um vídeo específico pelo `videoId`. | Should | F4 | Listagem de status |
| RF-11 | O usuário obtém uma URL de download temporária do zip, apenas quando o status é COMPLETED. | Must | F5 | Fazer download do zip |
| RF-12 | Quando o processamento falha de forma definitiva, o status vira FAILED e o usuário recebe um e-mail. | Must | F6 | Notificação em caso de erro |
| RF-13 | ~~E-mail de sucesso~~: **fora de escopo** (D15). O sucesso aparece na listagem. | Won't | F6 | — |
| RF-14 | Os status seguem a máquina `PENDING_UPLOAD → QUEUED → PROCESSING → COMPLETED \| FAILED` (mais `EXPIRED`, T02), e transições inválidas ou fora de ordem são ignoradas. | Must | F2–F6 | Listagem de status |
| RF-15 | Um upload não confirmado em 24 horas expira e fica com status EXPIRED. | Could | F2 | — |

## Requisitos não funcionais
| ID | Requisito verificável | Origem |
|---|---|---|
| RNF-01 | **Durabilidade:** toda confirmação aceita (HTTP 202) resulta em uma mensagem na fila. Isso é garantido por uma outbox transacional com relay. Nenhum vídeo fica parado em QUEUED por mais de 5 minutos sem processamento. | Não perder requisição |
| RNF-02 | **Picos:** o API Gateway responde 429 quando há throttling, e nunca descarta silenciosamente. O excesso vira backlog na fila. Um teste k6 com 50 uploads simultâneos termina com 100% dos vídeos em estado final. | Picos |
| RNF-03 | **Escalabilidade:** a API escala por CPU (HPA) e o worker escala pela profundidade da fila (KEDA), de 1 a 9 pods, com 1 job por pod e 1 CPU garantida (até 9 vídeos em paralelo em homolog), em node group spot dedicado (D34). Os serviços são stateless e não usam disco local persistente. | Escalável |
| RNF-04 | **Resiliência:** no máximo 3 tentativas por mensagem, depois a mensagem vai para a DLQ e o vídeo vira FAILED. Os consumidores são idempotentes (inbox por `messageId` e worker por `videoId`). O ffmpeg tem timeout de 15 minutos. | Robustez |
| RNF-05 | **Persistência:** PostgreSQL com um schema por serviço e migrações versionadas. Arquivos no S3 com lifecycle: vídeo bruto apagado em 1 dia e zip em 7 dias. | Persistir dados |
| RNF-06 | **Segurança:** ASVS L1 mais controles selecionados de L2.<br>- Senha com hash argon2id, mínimo de 12 caracteres e bloqueio das senhas mais comuns.<br>- Rate limit em login e refresh.<br>- JWT RS256 (`iss`, `aud`, `exp`, `jti`, `sid`) validado no gateway e nos serviços, que também consultam a lista de sessões revogadas no Redis.<br>- Refresh token opaco de 256 bits, guardado só como hash, rotação a cada uso e **detecção de reuso**: reuso revoga toda a sessão e registra evento de segurança.<br>- Bucket privado com SSE.<br>- Nenhum segredo versionado.<br>- Logs sem senha, token ou e-mail completo. | Protegido |
| RNF-07 | **Autorização:** toda leitura e escrita de vídeo é filtrada pelo `userId` do token. Um acesso a vídeo de outro usuário retorna 404. | Protegido |
| RNF-08 | **Qualidade:** cobertura Jest de pelo menos 80% por serviço (gate no Sonar), lint e regras de camada (dependency-cruiser), BDD Gherkin pt-BR ponta a ponta. | Testes |
| RNF-09 | **CI/CD:** cada repo tem um pipeline independente: security gate, lint, test, Sonar, audit, Trivy, build, ECR e EKS, com rollback automático (`rollout undo`). | CI/CD |
| RNF-10 | **Observabilidade:**<br>- Logs JSON com `correlationId`.<br>- Métricas Prometheus (RED por serviço, fila, DLQ e duração do processamento).<br>- Traces OTel propagados pela mensagem.<br>- Dashboard Grafana e alertas com runbook. | Monitoramento |
| RNF-11 | **Containers:** imagem multi-stage, usuário não-root, health e readiness probes, limites de CPU e memória. | Containers |
| RNF-12 | **Custo:** homolog em single-AZ com instâncias mínimas e destruída após a avaliação. Custo estimado documentado. | FinOps |
| RNF-13 | **Ambiente local:** `docker compose up` sobe a stack completa (Postgres, Redis, LocalStack, Mailpit, Prometheus, Grafana e os 4 serviços) sem conta AWS. | Demo |

## Restrições e fora de escopo
- NestJS 11 / Node 22, hexagonal pragmático, AWS (EKS, SQS, SNS, S3, RDS, ElastiCache, API Gateway e SES).
- Sem front-end: a demo é feita via Postman. Sem verificação de e-mail no cadastro, sem recuperação de senha e sem perfil admin.
- Fora de escopo: edição de vídeo, outros formatos de saída (só PNG em zip), multi-tenant, billing e Cognito.

## Rastreabilidade
| Fluxo | Resultado esperado | Requisitos |
|---|---|---|
| F1 | Cadastro e login emitem o par de tokens; refresh rotaciona; logout revoga; sem token, a resposta é 401 | RF-01–03, RF-02a/b, RNF-06 |
| F2 | O vídeo chega ao S3 e fica em QUEUED | RF-04–06, RF-14, RNF-01 |
| F3 | Vários vídeos em PROCESSING ao mesmo tempo terminam COMPLETED | RF-07–08, RNF-03–04 |
| F4 | A lista mostra os status corretos e atualizados | RF-09–10, RF-14 |
| F5 | O zip baixado contém os frames | RF-11 |
| F6 | Um vídeo inválido termina FAILED e gera e-mail | RF-12–13, RNF-04 |
| F7 | 50 uploads simultâneos, nenhuma perda | RNF-01–03 |
| F8 | O usuário B recebe 404 nos vídeos do usuário A | RF-03, RNF-07 |
| F9 | Um `correlationId` liga API → fila → worker → evento → notificação | RNF-10 |
| F10 | Pipelines verdes, cobertura de 80% ou mais e deploy com rollback | RNF-08–09, RNF-11 |
