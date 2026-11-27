# Avaliação de opções de nuvem e compute

Gate `cloud-selection`: opções pontuadas em custo, desempenho, qualidade e usabilidade, com uma recomendação única.

## 1. Provedor (nota de 1 a 5; peso entre parênteses)
| Critério | AWS | OCI | GCP | Só local |
|---|---|---|---|---|
| Custo (25%) | 3 | 5 | 3 | 5 |
| Desempenho e escala (20%) | 5 | 4 | 5 | 1 |
| Qualidade: aderência ao curso e reuso do modelo (35%) | 5 | 2 | 2 | 2 |
| Usabilidade: operação por 1 pessoa (20%) | 4 | 3 | 4 | 5 |
| **Total ponderado** | **4,4** | 3,3 | 3,3 | 3,2 |

**Recomendação: AWS** (ADR-015), mantendo o ambiente local para desenvolvimento e e2e (ADR-010).

## 2. Compute para os serviços (dentro da AWS)
| Critério | EKS | ECS Fargate | Lambda |
|---|---|---|---|
| Custo (25%) | 3 | 4 | 5 |
| Escala pela fila (20%) | 5 (KEDA) | 4 | 4 |
| Aderência ao enunciado e ao modelo (35%) | 5 | 3 | 2 |
| Usabilidade (20%) | 3 | 4 | 3 (limite de 15 min, ffmpeg em layer) |
| **Total** | **4,2** | 3,6 | 3,3 |

**Recomendação: EKS** (ADR-009). O Fargate fica como alternativa documentada para o tier Growth.

## 3. Mensageria
| Critério | SQS/SNS | Amazon MQ (RabbitMQ) | MSK (Kafka) |
|---|---|---|---|
| Custo | 5 | 2 | 1 |
| Operação | 5 | 3 | 2 |
| Atende os requisitos (fila durável + fan-out + DLQ) | 5 | 5 | 4 |
| **Recomendação** | **✔** | — | — |
