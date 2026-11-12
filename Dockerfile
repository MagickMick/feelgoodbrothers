# syntax=docker/dockerfile:1.7
# One Dockerfile, two images:
#   docker build --target web   -t magickmick/feelgoodbrothers-web .
#   docker build --target admin -t magickmick/feelgoodbrothers-admin .

ARG NODE_IMAGE=node:24-alpine

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false

# manifests only, so `npm ci` is cached until dependencies change
FROM base AS manifests
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/core/package.json packages/core/

# ---------------------------------------------------------------------------
FROM manifests AS deps
RUN --mount=type=cache,target=/root/.npm npm ci

FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
ARG SITE_URL=https://feelgoodbrothers.com
ENV SITE_URL=${SITE_URL}
RUN npm run build --workspace=@fgb/web \
 && npm run build --workspace=@fgb/admin \
 # small standalone CLI scripts (migrate / create-admin / import) for inside the container
 && npx esbuild packages/core/scripts/migrate.ts packages/core/scripts/create-admin.ts packages/core/scripts/import-mdx.ts \
      --bundle --platform=node --format=esm --target=node22 --packages=external \
      --outdir=packages/core/dist-scripts --out-extension:.js=.mjs

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    UPLOADS_DIR=/data/uploads \
    MIGRATIONS_DIR=/app/packages/core/drizzle
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
RUN mkdir -p /data/uploads && chown -R node:node /data

# ---------------------------------------------------------------------------
FROM runtime AS web
ENV PORT=4321
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4321/robots.txt >/dev/null || exit 1
CMD ["node", "apps/web/dist/server/entry.mjs"]

# ---------------------------------------------------------------------------
FROM runtime AS admin
ENV PORT=4322
COPY --from=build --chown=node:node /app/apps/admin/dist ./apps/admin/dist
COPY --from=build --chown=node:node /app/packages/core/drizzle ./packages/core/drizzle
COPY --from=build --chown=node:node /app/packages/core/dist-scripts ./scripts
COPY --from=build --chown=node:node /app/packages/core/seed ./seed
COPY --chown=node:node docker/admin-entrypoint.sh /usr/local/bin/admin-entrypoint.sh
USER node
EXPOSE 4322
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4322/health >/dev/null || exit 1
ENTRYPOINT ["/bin/sh", "/usr/local/bin/admin-entrypoint.sh"]
CMD ["node", "apps/admin/dist/server/entry.mjs"]
