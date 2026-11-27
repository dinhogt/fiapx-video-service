# Épicos: FIAP X Video Processor

| Épico | Resultado | Fluxos | Entregas | Gate de saída |
|---|---|---|---|---|
| EP-01 Identidade | Cadastro, login e JWT RS256 validados no edge e nos serviços | F1, F8 | 3 | security + implementation |
| EP-02 Ingestão de vídeos | Upload pré-assinado, confirmação durável (outbox) e status | F2, F4, F5 | 4 | implementation |
| EP-03 Processamento | Worker concorrente, idempotente e escalável, com frames + zip | F3, F7 | 5 | implementation + carga |
| EP-04 Notificação | E-mail em caso de falha, idempotente, SES/Mailpit | F6 | 6 | implementation |
| EP-05 Plataforma | Terraform, EKS, filas, CI/CD, rollback, ambiente local | F7, F10 | 2, 8 | infrastructure |
| EP-06 Observabilidade e qualidade | Prometheus/Grafana/OTel, alertas, BDD, k6, cobertura ≥ 80% | F9, F10 | 7, 9 | observability + release |

## Histórias essenciais

### EP-01
- Como usuário, quero criar uma conta com e-mail e senha para usar o sistema.
- Como usuário, quero fazer login e continuar conectado enquanto estiver usando o sistema, com a sessão expirando quando eu parar de usar ou sair.
- Como dono de um vídeo, quero que ninguém mais consiga ver ou baixar o que eu enviei.

### EP-02
- Como usuário, quero enviar um ou vários vídeos sem esperar o processamento terminar.
- Como usuário, quero ver a lista dos meus vídeos com o status de cada um.
- Como usuário, quero baixar o zip de um vídeo concluído.

### EP-03
- Como negócio, quero processar vários vídeos em paralelo e escalar em picos.
- Como operador, quero que uma falha de worker não perca nem duplique o processamento.

### EP-04
- Como usuário, quero ser avisado por e-mail quando o meu vídeo falhar.

### EP-05
- Como equipe, quero subir o sistema inteiro localmente com um comando.
- Como equipe, quero implantar cada serviço de forma independente, com rollback.

### EP-06
- Como suporte, quero seguir um vídeo por `correlationId` em logs, métricas e traces.
- Como avaliador, quero evidência de testes, cobertura, BDD e teste de carga.

## Definition of Ready
- A história tem critério de aceite (AC-xx) e fluxo associado.
- O contrato (HTTP ou mensagem) da história está definido.
- As dependências de infraestrutura estão disponíveis localmente (compose).

## Definition of Done
- Testes unitários e de integração verdes, com cobertura ≥ 80% no serviço.
- Lint, regras de camada, Sonar, audit e Trivy aprovados.
- Documentação (API contract, ADR se aplicável, runbook) atualizada no mesmo PR.
- Métricas e logs da funcionalidade visíveis no Grafana.
