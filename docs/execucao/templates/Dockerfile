# syntax=docker/dockerfile:1.7
# Base para auth-service, video-service e notification-service (RNF-11).
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN --mount=type=secret,id=npm_token NPM_TOKEN=$(cat /run/secrets/npm_token 2>/dev/null || true) yarn install --immutable
COPY tsconfig*.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN yarn prisma generate && yarn build && yarn workspaces focus --production

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -g 10001 app && useradd -u 10001 -g app -s /usr/sbin/nologin app \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && mkdir -p /etc/ssl/rds \
 && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /etc/ssl/rds/global-bundle.pem \
 && apt-get purge -y curl && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/package.json ./
USER 10001
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
