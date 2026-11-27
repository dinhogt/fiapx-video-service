# ADR-014: Pipeline de processamento do worker

| Campo | Valor |
|---|---|
| Status | Aceito |
| Decisões | D09, D13, D14 → D34, D27 (T03), D28 (T04) |
| Relacionados | ADR-003, ADR-004, ADR-005, ADR-009; especificação B3 e B5 |

## Contexto
O projeto base extrai todos os PNGs para o disco e depois gera o zip. Um vídeo de 1 h a 5 fps geraria cerca de 18 mil frames (cerca de 50 GB em 1080p). O worker processa conteúdo **não confiável**, e o ffmpeg tem histórico de CVEs.

## Decisão
- **Concorrência:** 1 loop de long-poll por pod, uma mensagem por vez, com 1 CPU garantida (D34). O paralelismo vem do número de pods (KEDA de 1 a 9).
- **Validação:** `ffprobe` (30 s de timeout) exige stream de vídeo. `ceil(duração × fps) ≤ 3600` (D28); acima disso, `VIDEO_TOO_LONG`.
- **Extração em janelas de 60 s** (D27): `ffmpeg -ss <start> -t 60 -i <input> -vf fps=<fps> -start_number <offset>`, com os frames entrando num zip em streaming (`archiver`, store) e saindo em upload multipart para o S3. Cada PNG é apagado assim que entra no zip. O pico de disco fica abaixo de 3Gi (`emptyDir`).
- **Segurança da execução:**
  - `spawn` com argumentos em array, nunca shell;
  - nome do arquivo nunca usado em caminho (usa-se `videoId`);
  - container non-root com `readOnlyRootFilesystem` e limites de CPU e memória;
  - timeout global de 15 min com `SIGKILL`;
  - a saída do ffmpeg nunca chega ao usuário.
- **Heartbeat:** `ChangeMessageVisibility(120 s)` a cada 60 s.
- **Falhas:** permanentes geram `video.failed` imediato. Transitórias retentam e, na 3ª tentativa, geram `video.failed` (B3).
- **Idempotência:** o zip existente faz o worker republicar `processed` (ADR-004).
- **Shutdown:** no SIGTERM, para o poll e termina os jobs em andamento (grace de 900 s).

## Alternativas
| Opção | Por que não |
|---|---|
| Extração única com disco grande | Volume caro e risco de encher o nó |
| `image2pipe` em memória | Parsing frágil, difícil de testar |
| Lambda / MediaConvert | Limite de 15 min e custo. O MediaConvert não gera PNG por fps livre sem pós-processamento. |

## Consequências
- Mais invocações de ffmpeg por vídeo (uma por minuto de vídeo), com overhead desprezível.
- Os frames são numerados globalmente (`frame_00001.png`…) e a ordem é preservada.
- Os testes usam uma fixture de 5 s e uma fixture corrompida, com ffmpeg real na imagem de CI.

## Governance
| # | Resposta |
|---|---|
| 1 | Aumenta pouco, e garante robustez |
| 2 | Sim |
| 3 | Extração única rejeitada (disco) |
| 4 | Sim |
| 5 | Reduz o custo de disco |
| 6 | Escala horizontal pela fila |

**Classificação: Recomendada.**
