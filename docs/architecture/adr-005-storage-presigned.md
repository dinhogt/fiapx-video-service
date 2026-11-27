# ADR-005: Armazenamento em S3 com upload e download pré-assinados

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D07, D13, D25 (T01), D26 (T02) |
| Relacionados | ADR-006, ADR-014; especificação B1 e B7 |

## Contexto
Vídeos de até 500 MB passando pela API transformariam o pod em gargalo de banda e memória justamente nos picos. O disco local do projeto base impede escalar horizontalmente.

## Decisão
- `POST /videos` cria o registro `PENDING_UPLOAD` e devolve um **presigned POST** válido por 15 min, com:
  - `content-length-range` de 1 a 524 288 000;
  - `Content-Type` fixo (mapeado pela extensão);
  - chave `raw/{userId}/{videoId}.{ext}` definida pelo servidor.
- O cliente envia o arquivo **direto ao S3**.
- `POST /videos/{id}/confirm` faz `HeadObject` e, na mesma transação, muda o status para `QUEUED` e grava a outbox (ADR-004). Não existe status `UPLOADED` (D26).
- O download usa GET pré-assinado de 5 min, com `Content-Disposition: attachment`, apenas para o dono e com status `COMPLETED`.
- Bucket privado: Block Public Access, SSE-S3, `aws:SecureTransport`. Lifecycle: `raw/` expira em 1 dia, `output/` em 7 dias, multipart incompleto em 1 dia.
- Uploads sem confirm em 24 h viram `EXPIRED` (job horário).

## Alternativas
| Opção | Por que não |
|---|---|
| Multipart pela API (projeto base) | A API carrega a banda e a memória e vira gargalo em picos |
| Presigned PUT | O tamanho não é imposto pelo S3 |
| Evento S3 → SQS no lugar do confirm | Mais uma fila e mais um consumidor. O confirm explícito é mais simples de testar. |

## Consequências
- O cliente faz três passos: criar, enviar e confirmar. A collection do Postman automatiza com scripts.
- **No ambiente local:** as URLs precisam ser assinadas com `S3_PUBLIC_ENDPOINT=localhost:4566` (B7).
- A chave nunca vem do cliente, o que elimina path traversal (o defeito do projeto base).

## Governance
| # | Resposta |
|---|---|
| 1 | Reduz a carga da API |
| 2 | Sim |
| 3 | Upload pela API rejeitado (escala) |
| 4 | Sim |
| 5 | S3 com lifecycle custa centavos |
| 6 | Escala sem mudança. CloudFront para download em 100 mil+. |

**Classificação: Recomendada.**
