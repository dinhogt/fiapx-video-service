# Visão da arquitetura na nuvem (AWS us-east-1, homolog)

O diagrama de implantação está em [diagrams.md §7](../architecture/diagrams.md). A topologia e os componentes estão em [solution-design.md](../architecture/solution-design.md).

| Camada | Recurso | Configuração |
|---|---|---|
| Rede | VPC 10.0.0.0/16, 2 AZ, subnets públicas e privadas | 1 NAT Gateway (custo) |
| Borda | API Gateway HTTP + VPC Link + NLB interno | Throttling 100/50, JWT authorizer, access logs de 7 dias |
| Compute | EKS 1.34: pool `apps` `t3.medium` 2–3 (on-demand) + pool `worker` spot `c7i/c6i/m6i.xlarge` 1–3 (taint) | Cluster Autoscaler, KEDA, metrics-server, envelope KMS para secrets |
| Dados | RDS PostgreSQL 16 `db.t4g.micro` | single-AZ, 20 GB gp3, criptografado, `rds.force_ssl=1`, backup de 1 dia |
| Cache | ElastiCache Valkey `cache.t4g.micro` ×2 | Multi-AZ, TLS, AUTH |
| Armazenamento | S3 `fiapx-homolog-videos-<acct>` | SSE, lifecycle de 1 e 7 dias |
| Mensageria | 4 filas + 4 DLQs, 2 tópicos SNS | SSE |
| E-mail | SES (sandbox) | Remetente e destinatário da demo verificados |
| Segredos | Secrets Manager | `fiapx/homolog/*` |
| Registry | ECR (4 repos) | Imutável, scan on push, lifecycle de 10 imagens |
| Identidade | IAM OIDC GitHub, IRSA por serviço | Mínimo privilégio (B14) |
| Custo | AWS Budgets de 50 USD | Alertas em 50%, 80% e 100% |
| State | S3 `fiapx-tfstate-<acct>` + DynamoDB `fiapx-tflock` | Criado por `scripts/bootstrap-state.sh` |

**Ordem de provisionamento:**
1. `bootstrap-state`
2. `data` (VPC, RDS, ElastiCache, S3, Budget, secrets)
3. `platform` (EKS, add-ons, filas, gateway, IRSA, ECR)
4. Job `db-init`
5. CD dos serviços

**Destroy:** a ordem inversa, pelo workflow manual do `fiapx-infra`.
