# Hackathon FIAP X: documentação e histórico

Esta pasta reúne tudo do projeto do hackathon (POSTECH SOAT, Fase 5): o enunciado, a análise das referências, o plano, as decisões e o histórico das sessões. É o ponto de partida para quem chega ao projeto.

> **Executor (humano ou LLM):** comece pelo [`../AGENTS.md`](../AGENTS.md).

| Arquivo | Conteúdo |
|---|---|
| [00-enunciado.md](00-enunciado.md) | Requisitos do PDF do hackathon, organizados em checklist |
| [01-plano-arquitetura.md](01-plano-arquitetura.md) | Plano de arquitetura e entrega aprovado (arquitetura, ADRs previstos, repos, roadmap) |
| [02-decisoes.md](02-decisoes.md) | Registro de cada decisão: pergunta, opções, escolha e motivo |
| [03-referencias.md](03-referencias.md) | Análise do projeto base, do projeto modelo (autoservicemanager) e da spec-skills-lib |
| [04-pendencias.md](04-pendencias.md) | O que falta para o plano ser executável por outra LLM (blocos A, B e C) |
| [05-especificacao-tecnica.md](05-especificacao-tecnica.md) | Especificação técnica B1–B16: contratos, dados, mensageria, falhas, nomes, CI, convenções |
| [governance/](governance/) | `global-rules.override.yaml` da spec-skills-lib (validado contra o schema) |
| [architecture/](architecture/) | Entrega 1: ADRs 001–015, solution design, diagramas Mermaid (C4, sequência, estados, deploy) |
| [security/](security/) | Threat model STRIDE e matriz de controles ASVS |
| [cloud/](cloud/) | Avaliação pontuada de opções e visão da arquitetura AWS |
| [finops/](finops/) | Plano de custo (≈ 10,5 USD/dia, ≈ 44,5 de 50 USD) e backlog de otimização |
| [06-revisao-critica.md](06-revisao-critica.md) | Revisão crítica: aderência, segurança, performance e estrutura (18 achados resolvidos) |
| [execucao/](execucao/) | **Pacote de execução:** playbook de tarefas (F0–F10) e templates de repositório |
| [delivery/](delivery/) | Roteiro do vídeo (≤ 10 min) e checklist de entrega (PDF → evidência) |
| [requirements/](requirements/) | Entrega 0: requisitos, critérios de aceite, épicos e WBS (caminhos da spec-skills-lib) |
| [historico.md](historico.md) | Linha do tempo das sessões de trabalho |

## Convenções
- Toda decisão nova entra primeiro em `02-decisoes.md`. Na fase de implementação, ela vira um ADR em `fiapx-video-service/docs/architecture/`.
- Toda sessão de trabalho adiciona uma entrada em `historico.md`.
- Estes documentos ficam **locais**. A documentação canônica que vai para o GitHub fica no repo `fiapx-video-service/docs`, nos mesmos moldes do `_local-entrega` do modelo.

## Estrutura do workspace
```
hackaton/
├── docs/              ← esta pasta
├── projeto-fiapx/     ← projeto base (Go/Gin), só referência; não alterar
├── spec-skills-lib/   ← referência de boas práticas (complex-flow)
└── fiapx-repos/       ← clones dos repos (a criar)
```
