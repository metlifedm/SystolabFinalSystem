# syntax=docker/dockerfile:1
# Build context: repo root — run as: docker build -f apps/api/Dockerfile .

# ── Stage 1: Build @systolab/shared ───────────────────────────────────────────
FROM node:20-alpine AS shared-builder
WORKDIR /build
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY tsconfig.base.json .
COPY packages/shared/src packages/shared/src/
RUN cd packages/shared && npm install && npm run build

# ── Stage 2: Compile API TypeScript ───────────────────────────────────────────
FROM node:20-alpine AS api-builder
WORKDIR /build
COPY --from=shared-builder /build/packages packages/
COPY --from=shared-builder /build/tsconfig.base.json .
COPY apps/api/package.json apps/api/package-lock.json* apps/api/
COPY apps/api/tsconfig.json apps/api/
# npm ci resolves file:../../packages/shared from the monorepo structure above
RUN cd apps/api && npm ci --ignore-scripts
COPY apps/api/src apps/api/src/
RUN cd apps/api && npm run build

# ── Stage 3: Production runtime ───────────────────────────────────────────────
FROM node:20-alpine AS runner

# Install Chromium + fonts for optional Playwright headless rendering.
# If SYSTOLAB_PLAYWRIGHT_ENABLED=false (default), this adds ~90 MB but is harmless.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    fontconfig \
    && fc-cache -fv

# Point Playwright to the system Chromium so no separate download is needed.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

# Non-root user for container security
RUN addgroup -S systolab && adduser -S systolab -G systolab

WORKDIR /app

# Copy shared package (production dist only)
COPY --from=shared-builder /build/packages/shared/dist packages/shared/dist/
COPY --from=shared-builder /build/packages/shared/package.json packages/shared/package.json

# Install production-only API deps (file: dep resolves against /app/packages/shared)
COPY apps/api/package.json apps/api/package-lock.json* apps/api/
RUN cd apps/api && npm ci --omit=dev --ignore-scripts

# Copy compiled API
COPY --from=api-builder /build/apps/api/dist apps/api/dist/

# Artifact storage directory (override with SYSTOLAB_ARTIFACT_DIR env var)
RUN mkdir -p /data/artifacts && chown systolab:systolab /data/artifacts

USER systolab

WORKDIR /app/apps/api
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:4100/health || exit 1

CMD ["node", "dist/server.js"]
