# Threat model (STRIDE-lite): FIAP X Video Processor

| Campo | Valor |
|---|---|
| Status | Aceito (Entrega 1, gate security-review) |
| Nível | ASVS L1 + controles L2 selecionados ([controls-matrix.md](controls-matrix.md)) |
| Revisão | Obrigatória sempre que uma fronteira de confiança mudar |

## 1. Escopo e ativos
| Ativo | Sensibilidade |
|---|---|
| Credenciais (hash de senha) | Alta |
| Tokens: chave privada RS256, refresh tokens | Crítica |
| E-mail e nome do usuário (PII, LGPD) | Média |
| Vídeos enviados e zips gerados (conteúdo do usuário) | Média/Alta |
| Disponibilidade do processamento | Média |
| Credenciais AWS e pipeline (supply chain) | Crítica |

## 2. Fronteiras de confiança
| ID | Fronteira |
|---|---|
| TB1 | Internet → API Gateway |
| TB2 | API Gateway → NLB → serviços (rede privada) |
| TB3 | Cliente → S3 (URL pré-assinada) |
| TB4 | Serviços ↔ SQS/SNS (mensagens entre serviços) |
| TB5 | Worker ↔ **conteúdo de vídeo não confiável** (ffmpeg) |
| TB6 | Serviços ↔ RDS / ElastiCache |
| TB7 | GitHub Actions → AWS (OIDC) e registry de pacotes |
| TB8 | notification → SES → caixa do usuário |

## 3. Ameaças e mitigações
| ID | STRIDE | Fronteira | Ameaça | Mitigação | Evidência |
|---|---|---|---|---|---|
| T-01 | S | TB1 | Credential stuffing ou força bruta no login | argon2id, rate limit 5/min por e-mail e por IP **real** (`x-client-ip` sobrescrito pelo gateway, S-01) (Redis, fail-closed), throttling no gateway, mensagens genéricas | AC-12 |
| T-02 | S | TB1 | Roubo e reuso de refresh token | Refresh opaco de uso único, detecção de reuso que revoga o `sid`, limite de 8 h | AC-15 |
| T-03 | S/E | TB2 | Token forjado ou revogado aceito por serviço interno | Os serviços revalidam a assinatura RS256, `iss`/`aud`/`exp` e a revogação. Redis fora resulta em 503. | AC-13, AC-17 |
| T-04 | I | TB1 | Enumeração de usuários (cadastro e login) | Login genérico. O cadastro devolve 409, um risco aceito e mitigado por rate limit. | R-03 |
| T-05 | E/I | TB1 | IDOR: acessar ou baixar o vídeo de outro usuário | Toda query filtra por `userId = sub`, com 404. A chave S3 inclui o `userId` e só o servidor assina. | AC-80 |
| T-06 | T | TB3 | Upload acima do limite ou de outro tipo, sobrescrita de chave | Presigned POST com `content-length-range`, `Content-Type` e chave fixa definida pelo servidor. 15 min de validade. | AC-20, D25 |
| T-07 | E/D | TB5 | Vídeo malicioso explorando ffmpeg (RCE) ou bomba de recursos | ffprobe antes, limite de 3.600 frames, timeout de 15 min com SIGKILL, `spawn` sem shell, non-root, rootfs read-only, `emptyDir` limitado, limits de CPU e memória, sem token de API no pod, IRSA restrito a prefixos. Trivy na imagem. | ADR-014 |
| T-08 | T/R | TB4 | Mensagem forjada ou repetida na fila | Só roles IRSA publicam (políticas de fila e tópico), SSE, `aws:SecureTransport`. Validação zod. Inbox e idempotência. | ADR-003/004 |
| T-09 | D | TB1/TB4 | Pico ou abuso esgotando workers | Throttling 429, fila como buffer, KEDA com teto de 10, Budget como alarme de custo | AC-70 |
| T-10 | I | TB4/TB8 | PII nos eventos, na DLQ ou nos logs | E-mail só em `user.registered` → réplica. Redaction de logs. `failureMessage` sem detalhes internos. | ADR-012, RNF-06 |
| T-11 | I | TB6 | Acesso lateral ao banco de outro serviço | Role por schema sem grants cruzados, SG só a partir dos nós, TLS no Redis com AUTH | ADR-007/008 |
| T-12 | T/E | TB7 | Comprometimento da supply chain (dependência, action, segredo vazado em repo público) | gitleaks em todo PR, `yarn npm audit`, Trivy, actions fixadas por SHA, OIDC sem chaves estáticas, roles por repo, `master` protegido | B15 |
| T-13 | S | TB8 | E-mail usado para phishing (conteúdo controlado pelo usuário) | Template fixo. O `fileName` é escapado e truncado. Nenhum link assinado no e-mail. | ADR-012 |
| T-14 | I | TB3 | URL de download vazada | Validade de 5 min, emitida só para o dono, zip apagado em 7 dias | AC-50 |
| T-15 | T | TB1 | Header injection no `Content-Disposition` via `fileName` | Nome sanitizado + RFC 5987 (S-02) | Teste unitário |
| T-16 | I | TB6 | Segredos do Kubernetes e tráfego do banco em claro | Envelope KMS no EKS (S-03), `rds.force_ssl` + `verify-full` (S-04), senhas fora do `init.sql` (S-06) | checkov, teste de conexão |

## 4. Riscos residuais (aceitos)
| ID | Risco | Justificativa |
|---|---|---|
| R-01 | Um access token vazado vale até 15 min se não houver logout | É o mínimo prático com o refresh rotativo (D17) |
| R-02 | RDS single-AZ em homolog | Custo (D22). Produção seria Multi-AZ. |
| R-03 | O cadastro revela que um e-mail existe (409) | Sem verificação de e-mail no escopo. Mitigado por rate limit. |
| R-04 | Sem antivírus no conteúdo enviado | Apenas frames PNG são devolvidos ao próprio dono |
| R-05 | Uma URL pré-assinada válida pode ser compartilhada pelo dono durante 5 min | Comportamento esperado do mecanismo |
| R-06 | A chave privada RS256 fica no tfstate | O state é criptografado, versionado e com acesso restrito. A rotação está documentada. |
| R-07 | A IRSA do worker lê `raw/*` de todos os usuários | Inerente à função. Mitigado pelo isolamento do container (ADR-014). |
| R-08 | Não há exclusão de conta (LGPD) | Fora de escopo. Os arquivos expiram em 1 e 7 dias. |
| R-09 | Uma interrupção spot atrasa um vídeo em andamento | Coberto por VT, retry e idempotência (D34) |
