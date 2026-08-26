# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts/clean-dist.mjs ./scripts/clean-dist.mjs
COPY src ./src
RUN npm run build && npm prune --omit=dev
RUN mkdir -p /app/runtime/data

FROM cgr.dev/chainguard/node:latest@sha256:3cf2a28e10607bd6758a4e56fbd5580ab9d041f2126e4e79ae50af29f9317f54 AS runtime
ENV NODE_ENV=production \
    MAILBRIDGE_CONFIG=/app/config/mailboxes.yaml \
    MAILBRIDGE_SECRET_DIR=/run/secrets/mailbridge \
    MAILBRIDGE_ID_KEY_FILE=mailbridge_id_hmac_key
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=build --chown=10001:10001 /app/runtime ./runtime
COPY --chown=10001:10001 package.json package-lock.json ./
USER 10001:10001
EXPOSE 3091
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/usr/bin/node", "-e", "fetch('http://127.0.0.1:3091/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["dist/index.js", "--transport", "http"]
