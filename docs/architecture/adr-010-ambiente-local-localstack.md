# ADR-010: Ambiente local completo com Docker Compose e LocalStack

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D02, D22 |
| Relacionados | ADR-003, ADR-005, ADR-011; especificação B12 |

## Contexto
A demo e os testes ponta a ponta precisam rodar sem custo e sem conta AWS (RNF-13). O orçamento AWS é de 50 USD (D22), então a homolog só sobe para validar e gravar.

## Decisão
- `fiapx-video-service/docker-compose.yml` sobe:
  - Postgres 16 (`init.sql`), Redis 7 (AOF), LocalStack 4 (S3, SQS, SNS) e Mailpit;
  - Alloy, Prometheus, Loki, Tempo e Grafana;
  - os Jobs de migração e os 4 serviços, com builds dos clones irmãos.
- O LocalStack cria os recursos de B8 com `<env>=local` por script `ready.d`.
- O código usa o **mesmo AWS SDK** nos dois ambientes. A diferença é só de configuração (`AWS_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `EMAIL_PROVIDER=smtp`).
- `make up`, `make e2e` e `make down`.

## Alternativas
| Opção | Por que não |
|---|---|
| RabbitMQ + MinIO localmente | Exigiria dois adapters por porta, com divergência entre ambientes |
| kind/minikube localmente | Mais pesado. O compose basta para a demo. Os manifests são validados no CI. |
| Só AWS | Custo e dependência de rede para testar |

## Consequências
- Comportamentos do LocalStack podem divergir da AWS (IAM não é imposto, por exemplo). As permissões são validadas em homolog.
- O compose exige cerca de 6 GB de RAM livres.

## Governance
| # | Resposta |
|---|---|
| 1 | Reduz o atrito de desenvolvimento |
| 2 | Sim |
| 3 | — |
| 4 | Sim |
| 5 | Zero |
| 6 | N/A (desenvolvimento) |

**Classificação: Recomendada.**
