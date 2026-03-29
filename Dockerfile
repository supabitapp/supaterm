# syntax=docker/dockerfile:1

# --- Base ---
FROM oven/bun:1.3 AS base
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/bridge/package.json packages/bridge/
RUN bun install --frozen-lockfile || bun install

# --- Server dev (source-mounted, hot reload) ---
FROM deps AS server-dev
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
ENV PORT=7681
EXPOSE 7681
CMD ["bun", "run", "--watch", "packages/server/src/index.ts"]

# --- Web dev (Vite HMR, source-mounted) ---
FROM deps AS web-dev
COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/
WORKDIR /app/packages/web
EXPOSE 5173
CMD ["bunx", "vite", "--host", "--port", "5173"]

# --- Build web for production ---
FROM deps AS web-build
COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/
RUN cd packages/web && bunx vite build

# --- Production server (serves built web + PTY) ---
FROM base AS production
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/package.json package.json
COPY --from=web-build /app/packages/web/dist packages/web/dist
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
ENV PORT=7681
ENV WEB_DIST=/app/packages/web/dist
EXPOSE 7681
CMD ["bun", "run", "packages/server/src/index.ts"]
