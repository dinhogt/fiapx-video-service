# Plano de custo de implementação

Gate `finops-implementation-cost`: plano de custo com meta de redução, e backlog limitado à fase.

## 1. Custo diário estimado da homolog ligada (us-east-1, on-demand, valores aproximados)
| Item | Cálculo | USD/dia |
|---|---|---|
| EKS control plane | 0,10/h | 2,40 |
| Pool `apps`: `t3.medium` (média de 2,2) | 2,2 × 0,0416/h | 2,20 |
| Pool `worker`: spot xlarge (média de 1,3; cerca de 0,07/h) | 1,3 × 0,07/h | 2,20 |
| KMS (chave EKS) | 1/mês | 0,03 |
| EBS dos nós + PVCs de observabilidade | cerca de 140 GB gp3 | 0,37 |
| NAT Gateway | 0,045/h + dados | 1,20 |
| NLB | 0,0225/h + LCU | 0,60 |
| RDS `db.t4g.micro` + 20 GB | 0,016/h | 0,40 |
| ElastiCache `cache.t4g.micro` ×2 | 2 × 0,016/h | 0,77 |
| Secrets Manager (cerca de 7 segredos) | 0,40/mês cada | 0,10 |
| API Gateway, SQS, SNS, S3, SES, ECR, CloudWatch | volume de demo | < 0,30 |
| **Total** | | **≈ 10,5 USD/dia** |

Os valores são aproximados. A fonte é a tabela pública de preços. Conferir no AWS Pricing Calculator antes do primeiro apply.

## 2. Orçamento (D22: 50 USD no total)
| Uso planejado | Dias ligada | USD |
|---|---|---|
| Primeiro apply e depuração da infra | 1,25 | 13 |
| Validação ponta a ponta + k6 | 1 | 10,5 |
| Ensaio e gravação do vídeo | 1 | 10,5 |
| Margem (falhas, reapply) | 1 | 10,5 |
| **Total** | **4,25** | **≈ 44,5** |

**Regra operacional:** destruir ao fim de cada sessão (workflow `destroy`). Nunca deixar ligada durante a noite. O alerta de 80% do Budget (40 USD) bloqueia novos applies até revisão.

## 3. Meta de redução
Uma homolog ligada 24×7 por 3 semanas custaria cerca de 220 USD. Com o regime efêmero, o custo cai para cerca de 45 USD: **redução de cerca de 80%**.

## 4. Decisões de custo já aplicadas
- 1 NAT Gateway, RDS single-AZ, instâncias `t4g`/`t3`, sem ambiente de prod (D20).
- **Worker em spot** (D34): cerca de 60% mais barato que on-demand, com a interrupção coberta pela idempotência.
- Redis gerenciado de 2 nós (D24): +0,77 USD/dia, aceito pela robustez.
- Observabilidade self-hosted no cluster, sem SaaS.
- Lifecycle no S3 (1 e 7 dias) e em ECR (10 imagens).
- Ambiente local completo para todo o desenvolvimento (ADR-010).
