# ADR-009: EKS com HPA, KEDA, Cluster Autoscaler e NLB por NodePort

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D02, D14 → D34, D20, D29 (T05), D33 (T09) |
| Relacionados | ADR-003, ADR-013, ADR-015; especificação B10 e B13 |

## Contexto
É preciso processar vários vídeos em paralelo (até 9 com a D34, que revisou os 10 pods × 2 jobs da D14) e escalar pelo backlog da fila, não pela CPU. O enunciado recomenda Kubernetes, e o modelo já tem Terraform para EKS. A referência `aws-scale-up.md` da lib prefere ECS Fargate abaixo de 10 mil usuários.

## Decisão
- **EKS 1.34** com dois managed node groups em subnets privadas (D34):
  - `apps`: `t3.medium` on-demand, 2–3 nós, para as APIs, o notification, a observabilidade e os add-ons;
  - `worker`: **spot** com tipos `c7i.xlarge`, `c6i.xlarge` e `m6i.xlarge` (4 vCPU), 1–3 nós, taint `workload=worker:NoSchedule`, disco de 50 GB.
- Secrets do Kubernetes com envelope KMS (S-03). O SG dos nós libera os NodePorts só a partir da VPC (S-05).
- **API (auth, video):** HPA de 2 a 5 réplicas, alvo de 70% de CPU, PDB `minAvailable: 1`.
- **Worker:** **KEDA** `ScaledObject` pela métrica `ApproximateNumberOfMessagesVisible` de `video-process` (alvo de 1 mensagem por pod), de **1 a 9 réplicas**, com **1 job por pod**. Requests de 1 CPU e 1,5Gi, limits de 2 CPU e 3Gi, `emptyDir` de 3Gi, `terminationGracePeriodSeconds: 900`. São até 9 vídeos em paralelo, 3 por nó.
- **Notification:** 1 a 2 réplicas, HPA por CPU.
- **Cluster Autoscaler** (Helm + IRSA) escala os dois node groups quando há pods pendentes. **D33:** sem ele, 10 workers (5 vCPU) mais as APIs e a observabilidade não cabem nos nós fixos.
- **Exposição:** API Gateway → VPC Link → NLB interno → **NodePort** (30081 auth, 30082 video) com target type `instance`, com o ASG anexado ao target group (D29).
- Namespaces: `fiapx`, `observability`, `keda`, `kube-system`.

## Alternativas
| Opção | Por que não |
|---|---|
| ECS Fargate (lib) | Escala por fila via Application Auto Scaling, mas perde o reuso do modelo e o Kubernetes recomendado pelo enunciado |
| Lambda para o worker | Limite de 15 min e de 10 GB em `/tmp`, e ffmpeg como layer. O timeout coincide com o limite e não sobra margem. |
| Registro de IP de pod no NLB (modelo) | Quebra com o autoscaling (D29) |
| Karpenter no lugar do Cluster Autoscaler | Mais poderoso, porém mais configuração e IAM para uma demo |
| Nós fixos sem autoscaler | 5 nós ligados o tempo todo custariam cerca de 2,5 vezes mais |

## Consequências
- Escalar nós leva cerca de 2 a 3 min, e os pods do worker ficam pendentes nesse intervalo. É aceitável porque a fila segura o backlog.
- Uma interrupção spot (aviso de 2 min) mata o job em andamento. A mensagem reaparece depois do VT e é reprocessada, coberta pelo ADR-004 (R-09).
- O worker deixa de disputar CPU com as APIs, porque o pool é isolado por taint.
- O NodePort adiciona um salto de kube-proxy, com impacto desprezível.
- O EKS cobra 0,10 USD/h pelo control plane mesmo ocioso, por isso o destroy entre sessões é obrigatório (D22).

## Governance
| # | Resposta |
|---|---|
| 1 | Aumenta frente ao Fargate e é justificado pelo enunciado e pelo reuso |
| 2 | Sim, com Terraform e Helm versionados |
| 3 | Fargate documentado e rejeitado acima |
| 4 | Sim |
| 5 | Cerca de 5 a 7 USD/dia, mitigado pelo destroy |
| 6 | 100 usuários: superdimensionado. 1 mil a 10 mil: adequado. 100 mil: Karpenter + spot para o worker. |

**Classificação: Uso Excepcional** (EKS abaixo de 10 mil usuários, justificado).
