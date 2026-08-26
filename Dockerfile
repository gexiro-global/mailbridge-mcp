# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts/clean-dist.mjs ./scripts/clean-dist.mjs
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    MAILBRIDGE_CONFIG=/app/config/mailboxes.yaml \
    MAILBRIDGE_SECRET_DIR=/run/secrets/mailbridge \
    MAILBRIDGE_ID_KEY_FILE=mailbridge_id_hmac_key
WORKDIR /app
RUN groupadd --system --gid 10001 mailbridge \
    && useradd --system --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent mailbridge \
    && mkdir -p /app/runtime/data \
    && chown -R 10001:10001 /app/runtime
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --chown=10001:10001 package.json package-lock.json ./
USER 10001:10001
EXPOSE 3091
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3091/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js", "--transport", "http"]
