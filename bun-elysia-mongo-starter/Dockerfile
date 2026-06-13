# Elysia deploy pattern: https://elysiajs.com/patterns/deploy
#
# --compile is incompatible with this project's deps:
#   - protobufjs: uses eval("require")("fs") for runtime proto loading
#   - pino: worker threads need node_modules on disk
#   - OpenTelemetry: monkey-patches node_modules at runtime
#
# Using Elysia's "Compile to JavaScript" approach instead:
#   bun build --minify-whitespace --minify-syntax --outfile dist/server.js
# Run with: bun dist/server.js

FROM oven/bun:1.3.14 AS base
WORKDIR /app

# install dependencies into a separate stage for better layer caching
FROM base AS install
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# build stage
FROM base AS build
COPY --from=install /app/node_modules node_modules
COPY . .

ENV NODE_ENV=production
RUN bun run typecheck

# Elysia "Compile to JavaScript" — bundles + tree-shakes into single file
# proto-loader, pino, OTel are external (need runtime node_modules access)
RUN bun build \
  --minify-whitespace \
  --minify-syntax \
  --target bun \
  --external @grpc/grpc-js \
  --external @grpc/proto-loader \
  --external pino \
  --external pino-loki \
  --external pino-pretty \
  --external @elysiajs/opentelemetry \
  --external @opentelemetry/api \
  --external @opentelemetry/exporter-metrics-otlp-proto \
  --external @opentelemetry/exporter-trace-otlp-proto \
  --external @opentelemetry/exporter-metrics-otlp-grpc \
  --external @opentelemetry/exporter-trace-otlp-grpc \
  --external @opentelemetry/instrumentation \
  --external @opentelemetry/instrumentation-amqplib \
  --external @opentelemetry/instrumentation-grpc \
  --external @opentelemetry/instrumentation-http \
  --external @opentelemetry/instrumentation-ioredis \
  --external @opentelemetry/instrumentation-mongoose \
  --external @opentelemetry/instrumentation-pino \
  --external @opentelemetry/instrumentation-runtime-node \
  --external @opentelemetry/instrumentation-undici \
  --external @opentelemetry/resources \
  --external @opentelemetry/sdk-metrics \
  --external @opentelemetry/sdk-trace-node \
  --external @opentelemetry/semantic-conventions \
  --outfile dist/server.js \
  src/index.ts

# production-only node_modules (for external packages)
RUN rm -rf node_modules && bun install --production --frozen-lockfile

# Minimal distroless production image — no shell, no package manager
FROM oven/bun:1.3.14-distroless

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules node_modules
# proto files must be at dist/protos/ because import.meta.dir resolves to /app/dist/
COPY --from=build /app/src/infrastructure/grpc/protos ./dist/protos
# .env.production removed — inject ALL production env vars via the platform's
# secret manager / env config (NODE_ENV and PORT are set below as defaults).
# COPY .env.production ./.env.production

ENV NODE_ENV=production
ENV PORT=4445

EXPOSE 4445 50051

ENTRYPOINT ["bun", "dist/server.js"]
