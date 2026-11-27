# Critérios de aceite: FIAP X Video Processor

## Entrega 0: governança e requisitos
| ID | Dado / Quando / Então | Evidência |
|---|---|---|
| AC-01 | Dado o repositório, quando a governança for lida, então `complex-flow`, complexidade `high`, `implementation_level: mvp`, NestJS, AWS e cobertura de 80% estarão ativos. | `global-rules.override.yaml` + `validate-local.sh` |
| AC-02 | Dado o enunciado, quando os requisitos forem revisados, então cada item do PDF estará ligado a um RF ou RNF, a um fluxo F1–F10 e a um épico. | `requirements.md`, `epics.md` |
| AC-03 | Dada a complexidade alta, quando o gate de intake executar, então o WBS e os épicos existirão com dependências e gates. | `wbs.md`, `epics.md` |

## Entrega 1: arquitetura
| ID | Dado / Quando / Então | Evidência |
|---|---|---|
| AC-04 | Dada a decomposição, quando a arquitetura for revisada, então auth, video, worker e notification terão responsabilidade, dados e contratos explícitos, sem banco compartilhado entre schemas. | ADRs 001–007, solution design |
| AC-05 | Dadas as mensagens, quando os contratos forem lidos, então o envelope (`messageId`, `correlationId`, `type`, `version`, `occurredAt`, `traceparent`) e os eventos `video.process`, `video.processed` e `video.failed` estarão versionados. | contrato de mensageria |
| AC-06 | Dadas as novas fronteiras de confiança, quando o gate de segurança executar, então as ameaças STRIDE, os controles ASVS, a análise de upload malicioso e a de IDOR estarão mapeados. | threat model + controls matrix |
| AC-07 | Dada a escolha da AWS, quando o gate de cloud/FinOps executar, então haverá comparação de opções, custo estimado e plano de destruição. | `cloud/`, `finops/` |

## Implementação (por fluxo)
| Fluxo | ID | Dado / Quando / Então |
|---|---|---|
| F1 | AC-10 | Dado um e-mail novo e uma senha válida, quando o usuário se cadastra, então recebe 201, sem a senha na resposta e com hash argon2id no banco. |
| F1 | AC-11 | Dado um e-mail já cadastrado, quando tenta cadastrar de novo, então recebe 409. |
| F1 | AC-12 | Dadas credenciais erradas, quando faz login, então recebe 401 com mensagem genérica. Depois de 5 falhas por minuto, recebe 429. |
| F1 | AC-14 | Dado um refresh token válido, quando chama `/auth/refresh`, então recebe um novo par, e o refresh anterior deixa de valer. |
| F1 | AC-15 | Dado um refresh token **já usado**, quando é reapresentado, então recebe 401, a sessão inteira (`sid`) é revogada e um evento de segurança é registrado. |
| F1 | AC-16 | Dada uma sessão sem uso por mais de 60 min, ou com mais de 8 h desde o login, quando tenta refresh, então recebe 401. |
| F1 | AC-17 | Dado um logout, quando o access token ainda não expirado é usado em `/videos`, então recebe 401 (sessão revogada). |
| F1 | AC-18 | Dado um access token emitido há mais de 15 min, quando é usado em `/videos`, então recebe 401, e o cliente obtém um novo par via `/auth/refresh` sem precisar de login. |
| F1 | AC-13 | Dado um token ausente, expirado ou com assinatura inválida, quando chama `/videos`, então recebe 401. |
| F2 | AC-20 | Dado um formato ou tamanho fora do permitido, ou fps fora de 0.1–5, quando solicita o upload, então recebe 400 e nenhum registro é criado. |
| F2 | AC-21 | Dada uma solicitação válida, quando o arquivo é enviado pela URL e o upload é confirmado, então recebe 202 e o status vira QUEUED, com uma mensagem na outbox na mesma transação. |
| F2 | AC-22 | Dada uma confirmação sem o objeto no S3, quando confirma, então recebe 409 e o status continua PENDING_UPLOAD. |
| F2 | AC-23 | Dada uma confirmação repetida, quando confirma duas vezes, então só uma mensagem é enfileirada (idempotente). |
| F3 | AC-30 | Dados 5 vídeos enfileirados, quando os workers consomem, então vários ficam em PROCESSING ao mesmo tempo e todos terminam COMPLETED. |
| F3 | AC-31 | Dada uma mensagem duplicada para um vídeo já COMPLETED, quando o worker a recebe, então ela é descartada sem reprocessar nem publicar evento de novo. |
| F3 | AC-32 | Dado um worker que morre no meio do processamento, quando o visibility timeout expira, então outro worker reprocessa e o resultado final é único. |
| F4 | AC-40 | Dado um usuário com vídeos em vários estados, quando lista, então vê apenas os próprios vídeos, paginados, com o status atual em até 5 s após cada evento. |
| F5 | AC-50 | Dado um vídeo COMPLETED, quando pede o download, então recebe uma URL temporária, e o zip contém N PNGs compatíveis com a duração e o fps. |
| F5 | AC-51 | Dado um vídeo que não está COMPLETED, quando pede o download, então recebe 409. |
| F6 | AC-60 | Dado um arquivo corrompido, quando é processado, então após as tentativas o status vira FAILED com motivo legível, e um e-mail chega no Mailpit ou SES. |
| F6 | AC-61 | Dado um evento `video.failed` duplicado, quando a notificação o consome, então só um e-mail é enviado. |
| F7 | AC-70 | Dados 50 uploads simultâneos (k6), quando a fila drena, então 100% dos vídeos estão COMPLETED ou FAILED, nenhum fica perdido em QUEUED e o worker escalou. |
| F7 | AC-71 | Dado o relay da outbox parado, quando volta, então as mensagens pendentes são publicadas. |
| F8 | AC-80 | Dado o usuário B, quando consulta ou baixa um vídeo do usuário A, então recebe 404. |
| F9 | AC-90 | Dado um `correlationId`, quando se busca nos logs e traces, então a jornada API → fila → worker → notificação aparece conectada. |
| F10 | AC-100 | Dado um PR, quando o CI roda, então lint, testes, cobertura ≥ 80%, Sonar, audit e Trivy passam antes do merge. |
| F10 | AC-101 | Dado um deploy com falha de readiness, quando o rollout expira, então o pipeline executa `rollout undo`. |
