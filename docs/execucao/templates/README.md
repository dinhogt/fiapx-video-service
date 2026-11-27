# Templates de repositório

Arquivos-base para copiar na tarefa F1.1 do playbook. Substitua `<svc>` pelo nome do serviço (`auth-service`, `video-service`, `video-worker`, `notification-service`). Adapte só o que estiver marcado com `# ADAPTAR`.

| Arquivo | Destino no repo |
|---|---|
| `Dockerfile` | `Dockerfile` (auth, video, notification) |
| `Dockerfile.worker` | `Dockerfile` (worker) |
| `dependency-cruiser.cjs` | `.dependency-cruiser.cjs` |
| `eslint.config.mjs` | `eslint.config.mjs` |
| `.prettierrc` | `.prettierrc` |
| `.prettierignore` | `.prettierignore` |
| `.editorconfig` | `.editorconfig` |
| `.dockerignore` | `.dockerignore` |
| `jest.config.ts` | `jest.config.ts` |
| `sonar-project.properties` | `sonar-project.properties` |
| `gitignore` | `.gitignore` |
| `env.example` | `.env.example` |
| `scripts/security-gate.sh` | `scripts/security-gate.sh` |
| `github/ci.yml` | `.github/workflows/ci.yml` |
| `github/pull_request_template.md` | `.github/pull_request_template.md` |
| `k8s/api.yaml` | `k8s/<svc>.yaml` (auth, video) |
| `k8s/worker.yaml` | `k8s/video-worker.yaml` |
| `k8s/migrate-job.yaml` | `k8s/migrate-job.yaml` (auth, video, notification) |
