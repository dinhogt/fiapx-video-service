# ADR-002: NestJS com arquitetura hexagonal pragmática

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D01 |
| Relacionados | ADR-001; modelo: ADR-003 do autoservicemanager |

## Contexto
Os quatro serviços precisam de estrutura previsível e testável, e precisam permitir a troca de adapters entre a AWS e o ambiente local (S3/LocalStack, SES/SMTP). O projeto base é Go/Gin. O projeto modelo e a spec-skills-lib usam NestJS.

## Decisão
- Node 22 LTS, TypeScript `strict`, NestJS 11 e yarn 4 em todos os serviços.
- Camadas: `domain` → `application` → `infrastructure` | `interfaces`. As portas (interfaces) ficam no domínio e os adapters na infraestrutura.
- As regras de dependência são verificadas no CI pelo dependency-cruiser:
  - `domain` não importa nada externo;
  - `application` importa apenas `domain`.
- A configuração é validada por zod no boot (fail-fast).
- A estrutura de pastas é idêntica nos quatro serviços (especificação, seção B9).

## Alternativas
| Opção | Por que não |
|---|---|
| Evoluir o Go do projeto base | Reaproveitaria o código de ffmpeg e zip, mas perderia o reuso de padrões, testes e CI do modelo. A lib classifica Go como Uso Excepcional. |
| Híbrido (NestJS + worker em Go) | Duas toolchains para uma pessoa, e o pacote de contratos duplicado |
| Clean architecture completa (use case por classe, presenters) | Cerimônia excessiva para o escopo |

## Consequências
- O worker chama o ffmpeg via `child_process.spawn`. O desempenho de CPU é o do próprio ffmpeg, então o Node não é gargalo.
- Os testes de domínio e de aplicação rodam sem infraestrutura. A integração usa Testcontainers.

## Governance
| # | Resposta |
|---|---|
| 1 | Neutra: um padrão único reduz a carga cognitiva |
| 2 | Sim |
| 3 | Camadas simples (controller e service) rejeitadas por acoplar à AWS |
| 4 | Excelente (stack oficial) |
| 5 | Sem impacto |
| 6 | Viável em todos os tiers |

**Classificação: Recomendada.**
