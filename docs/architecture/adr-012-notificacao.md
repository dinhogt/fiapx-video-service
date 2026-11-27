# ADR-012: Notificação por e-mail via consumidor dedicado e réplica de contato

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D15, D18, D32 |
| Relacionados | ADR-003, ADR-004; especificação B2 e B3 |

## Contexto
Em caso de erro, o usuário deve ser notificado (enunciado). O e-mail é PII e não deve circular nas filas de vídeo nem na DLQ.

## Decisão
- O `notification-service` consome:
  - `user-contacts`: o evento `user.registered` (outbox do auth, D32) faz upsert em `notification.user_contacts`;
  - `notifications`: o evento `video.failed` (filtro SNS) busca o contato, envia o e-mail e registra em `notification.notifications` e na inbox.
- Só falhas geram e-mail (D15).
- Porta `EmailSender` com dois adapters: **SES** (homolog, remetente verificado, sandbox) e **SMTP/Mailpit** (local).
- Template pt-BR: nome do arquivo, motivo seguro (`failureMessage`), data. Nenhum link assinado.
- Contato ausente lança erro e retenta (até 5 vezes, VT de 30 s). Depois vai para a DLQ com alarme.

## Alternativas
| Opção | Por que não |
|---|---|
| E-mail dentro do evento | PII nas filas e na DLQ |
| Consulta HTTP ao auth | Acoplamento síncrono |
| Lambda SNS → SES (modelo) | Paridade local ruim |
| E-mail também no sucesso | Fora do pedido. Ruído e cota do SES em sandbox (D15). |

## Consequências
- Consistência eventual: um vídeo que falha segundos depois do cadastro ainda é coberto pelo retry.
- O SES em sandbox só envia para endereços verificados, então o e-mail da demo precisa ser verificado.

## Governance
| # | Resposta |
|---|---|
| 1 | Neutra |
| 2 | Sim |
| 3 | E-mail no evento rejeitado (PII) |
| 4 | Sim |
| 5 | SES custa centavos |
| 6 | Novos canais (SMS, push) como novos adapters |

**Classificação: Recomendada.**
