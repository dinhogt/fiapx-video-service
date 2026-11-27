# Revisão crítica do plano (gate antes do pacote de execução)

| Campo | Valor |
|---|---|
| Data | 2026-11-20 |
| Escopo | Aderência ao enunciado, segurança, performance e estrutura, sobre D01–D33, especificação técnica e Entrega 1 |
| Resultado | **18 achados**, todos resolvidos. 1 exigiu decisão do usuário (D34). Os demais são correções técnicas aplicadas na especificação (seção B17) e nos ADRs. |

## 1. Aderência ao enunciado
| Item do PDF | Coberto por | Situação |
|---|---|---|
| Processar mais de um vídeo ao mesmo tempo | ADR-009/014, D34 (até 9 em paralelo) | ✅ (corrigido pelo P-01) |
| Não perder requisição em picos | ADR-003/004, AC-70/71 | ✅ |
| Usuário e senha | ADR-006 | ✅ |
| Listagem de status por usuário | B1 `GET /videos` | ✅ |
| Notificação em erro | ADR-012 | ✅ |
| Persistência | ADR-007 | ✅ |
| Arquitetura escalável | ADR-009 + D33/D34 | ✅ |
| GitHub, testes, CI/CD | ADR-013, B15 | ✅ (E2E no CI corrigido pelo E-01) |
| Documentação da arquitetura | `architecture/` | ✅ |
| Script do banco e dos recursos | `db/init.sql`, Terraform, script do LocalStack | ✅ (segredos no init.sql corrigidos pelo S-06) |
| Vídeo de até 10 min | C9 (pacote de execução) | ⏳ próximo passo |

## 2. Achados e resolução

### Segurança
| ID | Sev. | Achado | Resolução |
|---|---|---|---|
| S-01 | **Alta** | Rate limit por IP quebrado. Atrás de API Gateway → NLB → NodePort, o serviço só vê o IP do nó, e o `X-Forwarded-For` vindo do cliente é forjável. | O gateway **sobrescreve** o header `x-client-ip` com `$context.identity.sourceIp` (parameter mapping `overwrite:header`). Os serviços só confiam nele com `TRUST_GATEWAY_IP=true` (homolog); no ambiente local usam o IP do socket. |
| S-02 | Média | `Content-Disposition` do download montado com o `fileName` do usuário permite header injection | O nome é sanitizado para `[A-Za-z0-9._-]` (máx. 100, fallback `video`) mais `filename*=UTF-8''…` (RFC 5987) |
| S-03 | Média | K8s Secrets sem criptografia de envelope | EKS `encryption_config` com chave KMS dedicada (cerca de 1 USD/mês) |
| S-04 | Média | TLS para o Postgres não era obrigatório | Parameter group `rds.force_ssl=1` e `sslmode=verify-full` com o CA bundle do RDS embutido na imagem |
| S-05 | Média | Os NodePorts 30081/30082 ficariam abertos no SG dos nós | O SG dos nós libera 30081–30082 só a partir do CIDR da VPC (NLB interno). Os nós ficam em subnets privadas. |
| S-06 | **Alta** | `init.sql` criaria roles com senha, com risco de segredo versionado | O `init.sql` usa variáveis `psql` (`:'auth_password'`), passadas pelo Job a partir do Secret. No ambiente local vêm de `.env.local.example` com valores fictícios. |
| S-07 | Baixa | A IRSA do worker lê `raw/*` de todos os usuários | **Risco aceito (R-07):** o worker processa todos os vídeos por natureza. Mitigado pelo isolamento do container (ADR-014). |
| S-08 | Baixa | Exposição do Grafana | Sem rota pública. Acesso por `kubectl port-forward`, com senha de admin no Secret. |
| S-09 | Baixa | LGPD: não há exclusão de conta | **Risco aceito (R-08):** fora de escopo. Os dados de vídeo expiram em 1 e 7 dias. Documentado. |

### Performance e capacidade
| ID | Sev. | Achado | Resolução |
|---|---|---|---|
| P-01 | **Alta** | Worker subdimensionado (2 jobs com 500m de CPU), `t3` burstable com créditos esgotados sob ffmpeg contínuo, 5 nós que não comportam 10 workers | **D34:** node group **spot dedicado** (c7i/c6i/m6i.xlarge, 1–3 nós, taint `workload=worker`), **1 job por pod**, request de 1 CPU e 1,5Gi, limit de 2 CPU e 3Gi, KEDA de 1 a 9 pods. O pool de apps fica em `t3.medium`, de 2 a 3 nós. |
| P-02 | Média | Pool de conexões do Prisma: até 12 pods × 5 conexões, perto do `max_connections` do `db.t4g.micro` (cerca de 80) | `connection_limit=5` explícito na URL e orçamento documentado: auth 5×5 + video 5×5 + notification 2×3 = 56, mais as migrações. Alerta em 70 conexões. |
| P-03 | Baixa | Budget de p95 de 300 ms incompatível com argon2 (login e cadastro) | O alerta de p95 exclui `/auth/login` e `/auth/register`, que têm budget próprio de 800 ms |

### Estrutura e robustez
| ID | Sev. | Achado | Resolução |
|---|---|---|---|
| E-01 | Média | O E2E (BDD) depende dos 4 repos, e o CI do video-service não os tem | O workflow `e2e.yml` no video-service faz checkout dos repos irmãos públicos (`actions/checkout` com `repository:`), roda `docker compose up` e o Cucumber. Roda em PR para `develop` e sob demanda. O override de imagens do GHCR foi removido. |
| E-02 | Média | Não estava definido quem executa o `db-init` na AWS | Workflow `db-init.yml` no `fiapx-infra`: depois do `apply` de `platform`, aplica o Job `db-init` (imagem `postgres:16`, `init.sql` via ConfigMap, senhas via Secret) |
| E-03 | Baixa | Depois de 7 dias o zip expira, mas o download continuaria devolvendo URL | `VideoView.outputExpiresAt`. O download responde **410 Gone** depois da expiração. |
| E-04 | Baixa | Crescimento indefinido de outbox e inbox | Job de housekeeping a cada hora: outbox publicada há mais de 7 dias e inbox com mais de 14 dias são apagadas (a inbox é maior que a retenção da DLQ) |
| E-05 | Baixa | Jobs periódicos (expiração, housekeeping, reidratação) executados por várias réplicas | Operações idempotentes mais `pg_try_advisory_lock` por job. A reidratação é idempotente por natureza. |
| E-06 | Baixa | Os testes do worker precisam de ffmpeg no runner de CI | O CI do worker roda `apt-get install -y ffmpeg` antes dos testes. O e2e usa a própria imagem. |

## 3. Riscos residuais adicionados ao threat model
- **R-07:** a IRSA do worker tem amplitude de leitura em `raw/*` (S-07).
- **R-08:** não há exclusão de conta (LGPD) no escopo (S-09).
- **R-09:** uma interrupção spot no meio de um job atrasa aquele vídeo em cerca de VT + reprocessamento. O desenho idempotente cobre o caso (D34).

## 4. Conclusão
Com as correções aplicadas, **não restam lacunas conhecidas** de aderência, segurança, performance ou estrutura. O plano está apto para o pacote de execução (C6–C10).
