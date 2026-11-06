# Build from the repository root: docker build -f apps/base-plugin/Dockerfile .
FROM node:22-bookworm-slim AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/bot/package.json ./apps/bot/
COPY apps/base-plugin/package.json ./apps/base-plugin/
COPY packages/analysis-core/package.json ./packages/analysis-core/

FROM manifests AS build
RUN npm ci -w @ava/base-plugin -w @ava/analysis-core --no-fund --no-audit
COPY apps/base-plugin ./apps/base-plugin
COPY packages/analysis-core ./packages/analysis-core
RUN npm run build:plugin

FROM manifests
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
RUN npm ci --omit=dev -w @ava/base-plugin -w @ava/analysis-core --no-fund --no-audit
COPY --from=build /app/packages/analysis-core/dist ./packages/analysis-core/dist
COPY --from=build /app/apps/base-plugin/dist ./apps/base-plugin/dist
COPY --from=build /app/apps/base-plugin/server ./apps/base-plugin/server
COPY --from=build /app/apps/base-plugin/shared ./apps/base-plugin/shared
WORKDIR /app/apps/base-plugin
USER node
EXPOSE 3001
CMD ["node", "--import", "tsx", "server/index.ts"]
