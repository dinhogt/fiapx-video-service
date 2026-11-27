#!/usr/bin/env bash
# Roda o init.sql canônico do fiapx-infra com variáveis psql (S-06).
set -euo pipefail

: "${AUTH_DB_PASSWORD:?AUTH_DB_PASSWORD is required}"
: "${VIDEO_DB_PASSWORD:?VIDEO_DB_PASSWORD is required}"
: "${NOTIFICATION_DB_PASSWORD:?NOTIFICATION_DB_PASSWORD is required}"
: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"

psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  -v auth_password="${AUTH_DB_PASSWORD}" \
  -v video_password="${VIDEO_DB_PASSWORD}" \
  -v notification_password="${NOTIFICATION_DB_PASSWORD}" \
  -v dbname="${POSTGRES_DB}" \
  -f /init/init.sql
