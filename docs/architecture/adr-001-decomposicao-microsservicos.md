# ADR-001: Decomposição em quatro microsserviços

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D01, D03, D04, D15, D18 |
| Relacionados | ADR-002, ADR-003, ADR-007, ADR-013 |

## Contexto
O projeto base é um monolito que recebe, processa e serve vídeos dentro do mesmo request HTTP. Isso tem três consequências: um vídeo longo bloqueia a API, não dá para escalar o processamento separadamente e um pico derruba tudo. O enunciado pede processamento paralelo, nenhuma perda em picos, autenticação, listagem de status e notificação. A equipe é uma pessoa só, com cerca de 3 semanas.

## Decisão
Quatro serviços implantáveis de forma independente, cada um dono dos seus dados:

| Serviço | Responsabilidade | Dados | Perfil de carga |
|---|---|---|---|
| `auth-service` | Cadastro, login, sessão (access + refresh), JWKS, evento `user.registered` | schema `auth` | IO-bound, baixo volume |
| `video-service` | Upload pré-assinado, confirmação, status, listagem, download, consumo de eventos de status | schema `video` + S3 `raw/` (somente assinatura) | IO-bound, volume alto de leitura |
| `video-worker` | Extração de frames (ffmpeg), zip, eventos de progresso, falha e conclusão | sem banco; S3 `raw/` e `output/` | **CPU-bound**, escala pela fila |
| `notification-service` | E-mail de falha, réplica de contato | schema `notification` | IO-bound, eventual |

A comunicação síncrona só existe na borda (cliente → API Gateway → auth/video). Entre os serviços, tudo é assíncrono (ADR-003).

## Alternativas
| Opção | Por que não |
|---|---|
| Monolito modular + worker | Seria mais simples, mas o enunciado cobra microsserviços explicitamente, e auth e notificação perderiam a independência de deploy |
| Auth embutido no video-service | Ficaria com menos um repo, mas misturaria segredo de assinatura e superfície de credenciais com o domínio de vídeo |
| Notificação como Lambda (como no modelo) | O ambiente local ficaria diferente da AWS (LocalStack Lambda) e o padrão de consumidor ficaria duplicado |
| Mais serviços (status-service, upload-service) | Seria cerimônia sem ganho de escala para uma pessoa |

## Consequências
- Separar o worker (CPU) da API (IO) é o ganho real de escala: cada um tem o próprio HPA ou KEDA.
- Mais repositórios, pipelines e imagens, o que exige templates (playbook C8) para não divergirem.
- A consistência entre serviços é eventual. A listagem pode ficar até cerca de 5 s atrás do worker (AC-40).

## Governance
| # | Pergunta | Resposta |
|---|---|---|
| 1 | Complexidade | Aumenta frente ao monolito, e é exigida pelo enunciado. Mitigada por template único. |
| 2 | Operável por 1 pessoa | Sim, com compose único e CI padronizado |
| 3 | Alternativa mais simples | Monolito modular, rejeitado pelo critério de avaliação |
| 4 | Código gerado por IA | Sim, NestJS é o stack oficial |
| 5 | Custo | Sem custo adicional relevante: os mesmos nós executam os 4 serviços |
| 6 | Escala | 100 a 10 mil usuários com o mesmo desenho. Aos 100 mil, separar o worker por classe de vídeo. |

**Classificação: Uso Excepcional** (microsserviços por exigência do enunciado).
