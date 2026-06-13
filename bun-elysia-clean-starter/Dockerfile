# Elysia deploy pattern: https://elysiajs.com/patterns/deploy
#
# --compile is incompatible with some of this project's deps:
#   - pino: worker threads need node_modules on disk
#   - OpenTelemetry: monkey-patches node_modules at runtime
#   - @grpc/proto-loader: runtime proto loading (if you add a gRPC client)
#
# Using Elysia's "Compile to JavaScript" approach instead:
#   bun build --minify-whitespace --minify-syntax --outfile dist/server.js
#
# NOTE: deliberately NOT --minify (whitespace + syntax only): full minify
# mangles function names, which OpenTelemetry uses for span names.
# Instrumented/runtime-patched packages are --external and provided via
# production node_modules.

FROM oven/bun:1.3.14 AS base
WORKDIR /app

# install dependencies into a separate stage for better layer caching
FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# build stage
FROM base AS build
COPY --from=install /app/node_modules node_modules
COPY . .

ENV NODE_ENV=production
# Full static gate (typecheck + biome) — lint failures block the image, same
# as type errors.
RUN bun run verify

RUN bun build \
  --minify-whitespace \
  --minify-syntax \
  --target bun \
  --external @grpc/grpc-js \
  --external @grpc/proto-loader \
  --external pino \
  --external pino-pretty \
  --external @elysiajs/opentelemetry \
  --external @opentelemetry/api \
  --external @opentelemetry/exporter-trace-otlp-grpc \
  --external @opentelemetry/exporter-trace-otlp-proto \
  --external @opentelemetry/resources \
  --external @opentelemetry/sdk-trace-node \
  --outfile dist/server.js \
  src/index.ts

# production-only node_modules (for the external packages above)
RUN rm -rf node_modules && bun install --production --frozen-lockfile

# Minimal distroless production image — no shell, no package manager
FROM oven/bun:1.3.14-distroless

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules node_modules
# Drizzle migrations: migrate() in main.ts reads the .sql files + meta/_journal
# from disk at startup (prod) — they are NOT bundled into dist/server.js. The
# relative migrationsFolder path resolves against WORKDIR /app.
COPY --from=build /app/src/infrastructure/db/migrations ./src/infrastructure/db/migrations
# If you add a gRPC client, its proto files must be copied to dist/protos/
# because import.meta.dir resolves to /app/dist/:
#   COPY --from=build /app/src/infrastructure/grpc/protos ./dist/protos
# .env.production removed — inject ALL production env vars via the platform's
# secret manager / env config (NODE_ENV and PORT are set below as defaults).
# COPY .env.production ./.env.production

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

ENTRYPOINT ["bun", "dist/server.js"]
