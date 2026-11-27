# ADR-007: PostgreSQL com schema por serviço

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D19 → D24 |
| Relacionados | ADR-001, ADR-004; especificação B4; `db/init.sql` |

## Contexto
O enunciado exige persistência e recomenda PostgreSQL. O modelo usava MySQL + DynamoDB. O princípio é database-per-service, com orçamento de 50 USD (D22).

## Decisão
- Uma instância **RDS PostgreSQL 16** (`db.t4g.micro`, 20 GB gp3, criptografada, privada, backup de 1 dia, senha master no Secrets Manager nativo).
- **Um schema por serviço** (`auth`, `video`, `notification`), cada um com um **role próprio** que só tem acesso ao seu schema. O isolamento lógico é verificável por grants.
- O `db/init.sql` cria a extensão `citext`, os schemas, os roles e os grants. No compose roda no init do Postgres; na AWS roda como Job `db-init`.
- As tabelas vêm das migrações **Prisma** de cada serviço, executadas por um Job `migrate-<svc>` antes do rollout. O boot da aplicação nunca migra.
- O worker não tem banco (ADR-004).

## Alternativas
| Opção | Por que não |
|---|---|
| Uma instância RDS por serviço | Custo 3 vezes maior sem ganho na demo |
| DynamoDB (modelo) | A listagem paginada por usuário e a outbox transacional são naturais em SQL |
| Postgres dentro do cluster | Menos robusto. Rejeitado na D24. |

## Consequências
- Compartilhar a instância é um ponto único de falha de infraestrutura (single-AZ em homolog), aceito por custo. Em produção seria Multi-AZ (backlog FinOps).
- Os serviços não fazem join entre schemas. Dados de outro serviço chegam só por evento (ex.: `user_contacts`).

## Governance
| # | Resposta |
|---|---|
| 1 | Neutra |
| 2 | Sim |
| 3 | Já é a opção mais simples que respeita a fronteira |
| 4 | Sim (Prisma) |
| 5 | Cerca de 0,4 USD/dia |
| 6 | Em 10 mil, réplica de leitura; em 100 mil, uma instância por serviço |

**Classificação: Recomendada.**
