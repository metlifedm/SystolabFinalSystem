# syntax=docker/dockerfile:1
# Build context: repo root — run as: docker build -f apps/web/Dockerfile .

# ── Stage 1: Build @systolab/shared ───────────────────────────────────────────
FROM node:20-alpine AS shared-builder
WORKDIR /build
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY tsconfig.base.json .
COPY packages/shared/src packages/shared/src/
RUN cd packages/shared && npm install && npm run build

# ── Stage 2: Vite production build ────────────────────────────────────────────
FROM node:20-alpine AS web-builder
WORKDIR /build
COPY --from=shared-builder /build/packages packages/
COPY --from=shared-builder /build/tsconfig.base.json .
COPY apps/web/package.json apps/web/package-lock.json* apps/web/
COPY apps/web/tsconfig.json apps/web/
RUN cd apps/web && npm ci --ignore-scripts
COPY apps/web apps/web/
# VITE_API_URL must be set at build time so the frontend bundle targets the
# correct API origin. Pass via: --build-arg VITE_API_URL=https://api.example.com
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN cd apps/web && npm run build

# ── Stage 3: Nginx static file server ─────────────────────────────────────────
FROM nginx:1.27-alpine AS runner
COPY --from=web-builder /build/apps/web/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
