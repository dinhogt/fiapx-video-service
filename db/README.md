# Bootstrap do Postgres (local)

O SQL canônico fica em `fiapx-infra/db/init.sql` (B4).

Neste repo:
- `10-run-init.sh` — wrapper do `docker-entrypoint-initdb.d` que chama o SQL com `-v` (S-06).
- O compose monta `../fiapx-infra/db/init.sql` em `/init/init.sql`.
