# Build from the repository root: docker build -f apps/bot/Dockerfile .
FROM node:22-bookworm-slim AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/check-node.cjs ./scripts/check-node.cjs
COPY apps/bot/package.json ./apps/bot/
COPY apps/base-plugin/package.json ./apps/base-plugin/
COPY packages/analysis-core/package.json ./packages/analysis-core/

FROM manifests AS build
RUN npm ci -w @ava/bot -w @ava/analysis-core --no-fund --no-audit
COPY apps/bot/tsconfig.json ./apps/bot/
COPY apps/bot/src ./apps/bot/src
COPY packages/analysis-core ./packages/analysis-core
RUN npm run build:bot

FROM manifests
ENV NODE_ENV=production
RUN npm ci --omit=dev -w @ava/bot -w @ava/analysis-core --no-fund --no-audit
COPY apps/bot/ml ./apps/bot/ml
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv \
    && python3 -m venv /app/apps/bot/.venv \
    && /app/apps/bot/.venv/bin/pip install --no-cache-dir -r apps/bot/ml/requirements.txt \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 bot && useradd --uid 10001 --gid bot --create-home bot \
    && mkdir -p /app/data && chown bot:bot /app/data
COPY --from=build /app/packages/analysis-core/dist ./packages/analysis-core/dist
COPY --from=build /app/apps/bot/dist/src ./apps/bot/dist/src
WORKDIR /app/apps/bot
USER bot
CMD ["node", "dist/src/main.js"]
