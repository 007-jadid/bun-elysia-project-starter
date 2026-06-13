# bun-elysia-mongo-starter

A production-shaped starter for backend services on **Bun + ElysiaJS + MongoDB
(Mongoose)**, laid out in clean / layered architecture. It ships the full
plumbing — config validation, HTTP server, auth, logging, graceful shutdown,
MongoDB, Redis, RabbitMQ, S3 uploads, a gRPC server, and OpenTelemetry — with
**no business logic**. Clone it, add your own domains, delete what you don't need.

> Prefer SQL? See the sibling `bun-elysia-clean-starter` (Postgres + Drizzle).
> Same architecture, same conventions, relational instead of document store.

## Quickstart

```bash
bun install
bun run docker:dev   # MongoDB, Redis, RabbitMQ via docker compose
bun dev              # typecheck then start with --watch
```

The service boots against the committed `.env.local` with zero extra config.
The only HTTP route mounted is the health probe; the gRPC server exposes a
generic `Health/Check`. API docs (non-prod): http://localhost:4445/apidocs

## Layout

```
src/
├── index.ts                 # entry — telemetry-first bootstrap
├── main.ts                  # connect deps (fail-fast) → HTTP + gRPC → graceful shutdown
├── instrumentation.ts       # OpenTelemetry setup (optional, OTEL_ENABLED)
├── config/                  # env validation (Zod) + constants (cache TTLs, RMQ topology)
├── http/
│   ├── server.ts            # pure wiring: middleware → health → /v1 feature groups
│   ├── middleware/          # cors, body-limit, logging/request-context, security-headers, error, requireAuth, requireCMS
│   ├── routes/              # route factories taking deps as arguments (DI by argument)
│   ├── schemas/             # response envelopes + reference models
│   └── helpers/             # small HTTP-layer helpers
├── domain/                  # YOUR business logic goes here (pure; no Elysia imports)
│   └── interfaces/          # ports implemented by infrastructure gateways/adapters
├── infrastructure/
│   ├── composition-root.ts  # the one place that wires ports → repositories → use cases
│   ├── db/mongoose/         # Mongoose connection manager + schemas (commonFields + your collections)
│   ├── repositories/        # repository implementations + a type-safe document→domain mapper
│   ├── cache/               # Bun-native Redis read/write clients
│   ├── rmq/                 # RabbitMQ connection (reconnect + leak guards) + consumers registry
│   ├── grpc/                # gRPC server (generic Health service) + protos/
│   └── s3/                  # Bun-native S3 client + upload/delete helpers
├── lib/                     # logger (pino + OTel context mixin), date, id, metrics, result, tracing, validation
└── types/                   # shared types (e.g. JWT/auth user shape)
```

## What's wired vs. what's yours

- **Wired and working:** env validation, HTTP server, health/readiness probes,
  CORS + security headers + request logging + correlation IDs + global error
  boundary + body-size limit, JWT verification (`requireAuth` / `requireCMS`),
  MongoDB (Mongoose) connection with health check, Redis read/write clients,
  RabbitMQ connection with auto-reconnect, a gRPC server (generic `Health/Check`
  with an `x-api-key` auth interceptor), S3 helpers, OpenTelemetry, and graceful
  shutdown.
- **Yours to add:** everything under `src/domain/` (entities, use cases),
  `src/infrastructure/db/mongoose/schemas/` (Mongoose schemas) and
  `repositories/` (implementations), feature routes/schemas under `src/http/`,
  RMQ consumers, and real gRPC services. Each barrel/registry file marks the
  spot with a comment.

## Adding a feature (the loop)

1. Define a Mongoose schema in `src/infrastructure/db/mongoose/schemas/` and
   export it from `schemas/index.ts`.
2. Write the domain port + use cases under `src/domain/<feature>/`.
3. Implement the repository in `src/infrastructure/repositories/` (the
   `type-safe-mapper` helps map documents → domain entities) and export it from
   `repositories/index.ts`.
4. Register the model + wire repository → use cases in
   `src/infrastructure/composition-root.ts`.
5. Add a route factory in `src/http/routes/`, export it from `routes/index.ts`,
   and mount it in `src/http/server.ts`.

## Conventions

- **Functional style** — factory functions returning object literals; no classes
  (except the logger wrapper / `AppError`).
- **DI by arguments** — route factories receive `deps` (`createXRoutes(deps)`);
  dependencies are wired in the composition root, never via `.decorate`.
- **Access level per route group** — `public` (no plugin) / `private`
  (`.use(requireAuth)`) / `admin` (`.use(requireCMS)`). Auth is never global.
- **JWT** — this service only **verifies** tokens (HS256 shared secret). It does
  not sign.
- **Code style** — Zod for env validation; single quotes, no semicolons (Biome).
  The `@/*` path alias maps to `src/*`.

## Health & probes

| Path | Meaning | Notes |
|------|---------|-------|
| `GET /health` | full status + per-dependency detail | DB down ⇒ `unhealthy`; Redis/RMQ/gRPC down ⇒ `degraded` |
| `GET /health/ready` | readiness — gates on **MongoDB** | `not_ready` when the DB is unreachable |
| gRPC `Health/Check` | gRPC liveness ping | returns `{ ok: true }` while serving |

These are the only routes the starter mounts.

## gRPC

A gRPC server starts alongside the HTTP server on `GRPC_PORT` (default `50051`).
It loads `src/infrastructure/grpc/protos/health.proto` at runtime and serves a
single `Health/Check`. Add your own service by dropping a `.proto` in `protos/`,
loading it in `server.ts`, and registering handlers. Inbound calls are checked
against `GRPC_SHARED_SECRET` (sent as `x-api-key` metadata) when that env var is
set; auth is skipped when it's empty (local dev).

## Environment

Required: `MONGO_URI`, `WRITE_REDIS_URL`, `READ_REDIS_URL`, `RABBITMQ_URL`,
`JWT_SECRET` (≥32 chars), `S3_*`. Optional: `GRPC_SHARED_SECRET`, `OTEL_*`,
`LOKI_*`, `ENABLE_OPENAPI`, `LOG_LEVEL`. See `.env.example` for the full list.

Committed templates: `.env.local` (works with `docker:dev`), `.env.development`,
`.env.example` (reference). In production, all env vars are injected by the
platform — there is no committed `.env.production`.

## Commands

```bash
bun dev               # typecheck + watch mode
bun run check         # typecheck + biome (write)
bun run typecheck     # tsc --noEmit
bun run docker:dev    # local infra (MongoDB / Redis / RabbitMQ)
```

## Docker

```bash
docker build -t app-service .   # typecheck runs inside the build
```

Multi-stage build → distroless runtime. The image copies the gRPC `protos/`
folder; no env file is baked in — inject all production env vars via your
platform's secret manager.

## License

MIT — do whatever you want.
# bun-elysia-project-starter
