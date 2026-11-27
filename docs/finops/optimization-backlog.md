# Backlog de otimização de custo

Itens **fora** do escopo do hackathon, mas documentados para os tiers seguintes:

| # | Otimização | Economia estimada | Quando |
|---|---|---|---|
| O-01 | ~~Nós spot para o worker~~ | — | **Já adotado (D34)** |
| O-02 | Nós Graviton (`t4g`/`m7g`) com imagens multi-arch | cerca de 20% do compute | Growth |
| O-03 | VPC endpoints para S3 (gateway, gratuito) e ECR, reduzindo o tráfego de NAT | Dados de NAT | Quando o tráfego de vídeo crescer |
| O-04 | Karpenter no lugar do Cluster Autoscaler (bin packing) | 10–20% dos nós | Scale |
| O-05 | CloudFront na frente do download do S3 | Egress | Scale |
| O-06 | Scale-to-zero do worker (KEDA `minReplicaCount: 0`) | 1 pod ocioso | Já possível em homolog (avaliar o cold start) |
| O-07 | Savings Plans para a base estável | 20–30% | Produção |
| O-08 | Agendamento para desligar homolog fora do horário | Até 60% | Se a homolog virar permanente |
