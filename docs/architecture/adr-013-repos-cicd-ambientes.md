# ADR-013: Multi-repo, CI/CD com GitHub Actions + OIDC e somente homolog

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D04, D10, D11, D20, D22, D23 |
| Relacionados | ADR-009; especificação B11, B15 e B16; modelo: ADR-009 |

## Contexto
O enunciado exige GitHub, testes e CI/CD. O modelo usa um repositório por serviço e OIDC com a AWS. O orçamento é de 50 USD.

## Decisão
- Repositórios **públicos** na conta `dinhogt`: `fiapx-auth-service`, `fiapx-video-service` (documentação canônica, pacote de contratos, compose, BDD), `fiapx-video-worker`, `fiapx-notification-service` e `fiapx-infra`.
- Um único repo de infra com **dois root modules** (`data` e `platform`) e states separados. É um desvio consciente do modelo, que tinha dois repos.
- Branches `feature/*` → `develop` → `master`. O `master` é protegido.
- **CI** em todo PR: security-gate (gitleaks), lint, depcruise, testes com cobertura ≥ 80%, Sonar, audit, build, Trivy.
- **CD:**
  - `develop` → ECR → migrate Job → rollout em **homolog** → `rollout undo` se falhar → smoke.
  - `master` → tag SemVer e GitHub Release, **sem deploy** (D20).
- Infra: `plan` em PR; `apply` em `develop` com aprovação manual (environment `homolog`); workflow de `destroy` manual.
- AWS via **GitHub OIDC** (uma role por repo, mínimo privilégio). Nenhuma chave estática.
- **AWS Budgets** de 50 USD com alertas em 50%, 80% e 100%.

## Alternativas
| Opção | Por que não |
|---|---|
| Monorepo | Mais simples, mas o usuário preferiu fidelidade ao modelo (D04) |
| Homolog + prod | Custo dobrado (D20) |
| Chaves IAM em secrets | Risco de vazamento em repo público |

## Consequências
- Cinco pipelines para manter, o que exige template de workflow reutilizável.
- O pacote de contratos no GitHub Packages exige token de leitura, inclusive no CI (B11).
- A homolog fica desligada na maior parte do tempo. A avaliação usa o vídeo e o ambiente local.

## Governance
| # | Resposta |
|---|---|
| 1 | Aumenta frente ao monorepo (escolha do usuário) |
| 2 | Sim, com templates |
| 3 | Monorepo documentado |
| 4 | Sim |
| 5 | GitHub e Sonar gratuitos (repos públicos) |
| 6 | Viável |

**Classificação: Recomendada.**
