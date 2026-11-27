# Matriz de controles (ASVS): FIAP X Video Processor

Nível: **L1 completo para o escopo** + controles **L2** selecionados (marcados com ★). A referência é o `rules/security-playbook.yaml` da spec-skills-lib.

| Controle (playbook) | Implementação | Onde | Verificação |
|---|---|---|---|
| V1.1 SDLC seguro | Threat model, gate de segurança no CI, ADRs | docs, CI | Revisão em PR |
| V1.2 Requisitos de segurança documentados | RNF-06/07, este documento | `requirements/` | Gate requirements-quality |
| ★ V1.4 Threat model | [threat-model.md](threat-model.md) | docs | Gate security-review |
| V2.1 Validação de entrada nas bordas | DTOs com class-validator/zod (HTTP), zod (mensagens), config zod | todos | Testes unitários (AC-20) |
| V2.4 Output encoding | JSON serializado pelo framework. `fileName` escapado no template de e-mail. | video, notification | Teste do template |
| ★ V2.5 Queries parametrizadas | Prisma. `$queryRaw` só com template tagged. | todos | Lint `no-restricted-syntax` para `$queryRawUnsafe` |
| V3.1 Autenticação básica | E-mail e senha ≥ 12, argon2id, lista de senhas comuns | auth | AC-10..12 |
| ★ V3.x Gestão de sessão | Access de 15 min, refresh rotativo, reuso revoga, idle de 60 min, absoluto de 8 h, logout revoga | auth + Redis | AC-14..18 |
| V4.1 Controle de acesso | JWT obrigatório em `/videos*`. Filtro por `userId`. | gateway, video | AC-13, AC-80 |
| ★ V4.2 Negar por padrão | Guard global, com rotas públicas explicitamente anotadas (`@Public`) | auth, video | Teste que varre as rotas |
| V6.1 Sem segredos no código | gitleaks, `.env` fora do git, Secrets Manager e K8s Secrets | todos | security-gate |
| V7.1 Lockfiles e audit | `yarn.lock` versionado, `yarn npm audit --severity high` | CI | Job audit |
| V10.1 Logs sem segredos e PII | Redaction pino (`password`, `refreshToken`, `authorization`, `email`) | todos | Teste de redaction |
| ★ V8.1 Dados em repouso e em trânsito | RDS (`force_ssl`, `verify-full`) e ElastiCache criptografados com TLS; S3 SSE + SecureTransport; SQS/SNS SSE; Secrets do EKS com envelope KMS | infra | checkov / tfsec |
| ★ V14.1 Headers e transporte | HTTPS no gateway, `helmet` nos serviços, sem CORS (cliente Postman) | gateway, serviços | Smoke test |
| Rate limiting de auth (playbook) | Redis fail-closed + throttling no gateway, com IP real via `x-client-ip` sobrescrito pelo gateway | auth, gateway | AC-12 |
| Header injection | `Content-Disposition` sanitizado + RFC 5987 | video | Teste unitário |
| Fail-secure de auth (role security) | Redis ou JWKS indisponível resulta em 503, nunca em acesso | auth, video | Teste de integração com Redis parado |
| Containers | non-root, rootfs read-only, sem capabilities, Trivy | todos | Job image |
| Execução de processo externo | `spawn` com array, timeout, limites | worker | Teste unitário do builder de argumentos |

**Fora do escopo (justificado):** SBOM (`sbom_required: false` em mvp), MFA, verificação de e-mail, WAF (o throttling do gateway cobre a demo).

## Checklist de release (security playbook)
- [ ] Threat model atualizado se uma fronteira mudou
- [ ] Audit sem high/critical em aberto
- [ ] Nenhum segredo no diff (gitleaks verde)
- [ ] Gate de segurança do CI verde em todos os repos
