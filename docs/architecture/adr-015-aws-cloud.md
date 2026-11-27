# ADR-015: AWS como provedor de nuvem

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D02, D05, D22 |
| Relacionados | `docs/cloud/option-evaluation.md`; lib: `cloud_preference` OCI-first |

## Contexto
A spec-skills-lib recomenda a OCI primeiro e classifica a AWS como "Uso Excepcional". O curso e o projeto modelo foram construídos em AWS (EKS, SQS, SNS, RDS, API Gateway, OIDC), em conta pessoal (D05).

## Decisão
Usar **AWS us-east-1** com os serviços: EKS, ECR, API Gateway HTTP, NLB, SQS, SNS, S3, RDS PostgreSQL, ElastiCache Valkey, SES, Secrets Manager, Budgets e IAM/OIDC. O código não depende de AWS no domínio: as portas hexagonais permitem trocar os adapters.

## Alternativas
Ver o comparativo pontuado em `docs/cloud/option-evaluation.md`: OCI, GCP e só local.

## Consequências
- Reaproveita cerca de 60% do Terraform e dos pipelines do modelo.
- Custo mais alto que a OCI, mitigado por homolog efêmera e Budget (D22).

## Governance
| # | Resposta |
|---|---|
| 1 | Reduz para este projeto (reuso) |
| 2 | Sim |
| 3 | OCI rejeitada: sem reuso, e o curso é em AWS |
| 4 | Sim |
| 5 | Cerca de 10,5 USD/dia ligada, ≈ 44,5 USD no total (abaixo de 50) |
| 6 | Escala em todos os tiers |

**Classificação: Uso Excepcional** (justificado).
