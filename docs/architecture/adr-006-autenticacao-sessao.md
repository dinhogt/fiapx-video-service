# ADR-006: Autenticação própria com JWT RS256 e sessão com refresh rotativo

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D16, D17, D24, D30 (T06), D32 |
| Relacionados | ADR-008, ADR-009; especificação B1 e B14; threat model T-01..T-04 |

## Contexto
O enunciado exige "usuário e senha". O modelo autenticava por CPF via Lambda e os serviços confiavam apenas nos headers do API Gateway. A prioridade declarada é a segurança (D16): sessão íntegra, revogável e resistente a roubo de token.

## Decisão
**Credenciais:**
- Cadastro com e-mail (citext, único) e senha de 12 a 128 caracteres, checada contra a lista das 10 mil senhas mais comuns.
- Hash argon2id (m = 19 MiB, t = 2, p = 1).

**Tokens:**
| Item | Regra |
|---|---|
| Access | JWT RS256, **15 min**, claims `iss`, `aud = fiapx-api`, `sub`, `sid`, `jti`, `iat`, `exp`, e `kid` no header |
| Refresh | Opaco, 256 bits, guardado só como hash SHA-256, **uso único** (rotação), 60 min de inatividade |
| Sessão | Desliza com o uso, com **limite absoluto de 8 h** |
| Reuso de refresh | Revoga a sessão inteira (`REFRESH_REUSE`) e registra um evento de segurança |
| Logout | Revoga o `sid` |

**Revogação:**
- **Fonte da verdade:** `auth.sessions.revoked_at` no Postgres.
- **Camada rápida:** `revoked:sid:{sid}` no Redis, com TTL de 900 s.
- **Reidratação** a cada 60 s e no boot (ADR-008).

**Validação em duas camadas:**
1. API Gateway com JWT authorizer. O issuer é a URL do próprio gateway e o auth serve `/.well-known/openid-configuration` e `/.well-known/jwks.json` em rotas públicas (D30).
2. Os serviços revalidam a assinatura (JWKS em cache de 10 min), `iss`, `aud` e `exp`, e consultam a revogação no Redis. Se o Redis estiver indisponível, a resposta é **503 (fail-closed)**.

**Rate limit:** login 5/min por e-mail e por IP; refresh 20/min por IP; no gateway, burst 10 / rate 5 em `/auth/login`. O IP é o `x-client-ip` **sobrescrito pelo gateway** com `$context.identity.sourceIp`, e nunca o `X-Forwarded-For` do cliente (S-01). As mensagens são genéricas (sem enumeração).

## Alternativas
| Opção | Por que não |
|---|---|
| Amazon Cognito | Não roda localmente (D02) e esconde os controles que o curso quer ver |
| Access de 60 min (D16 original) | Janela de 60 min para um token vazado. Substituído pela D17. |
| Só o authorizer do gateway (modelo) | Não revoga e confia na rede interna. Defeito corrigido. |
| Refresh JWT stateless | Não detecta reuso nem revoga |
| Chave em S3 + CloudFront (modelo) | Mais infraestrutura, e a rotação depende do Terraform (D30) |

## Consequências
- O Postman precisa de um script de refresh automático (pré-request) quando o access expira.
- O Redis se torna dependência de disponibilidade da autenticação, mitigado pelo ElastiCache Multi-AZ (ADR-008).
- O issuer depende da URL do gateway, que é injetada via ConfigMap depois do `terraform apply`.
- A rotação de chave acontece com dois `kid` publicados no JWKS durante a transição.

## Governance
| # | Resposta |
|---|---|
| 1 | Aumenta, e é justificado pela prioridade de segurança |
| 2 | Sim |
| 3 | Cognito rejeitado (local) |
| 4 | Sim (`jose`, `argon2`) |
| 5 | Nulo |
| 6 | Viável. Em 100 mil+, avaliar um IdP gerenciado. |

**Classificação: Recomendada.**
