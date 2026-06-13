# bun-elysia-clean-starter

A production-shaped starter for backend services on **Bun + ElysiaJS**, laid out
in clean / layered architecture. It ships the full plumbing — config validation,
HTTP server, auth, logging, graceful shutdown, Postgres (Drizzle), Redis,
RabbitMQ, S3 uploads, and OpenTelemetry — with **no business logic**. Clone it,
add your own domains, delete what you don't need.

## Quickstart

```bash
bun install
bun run deps:up      # Postgres (host port 5433), Redis, RabbitMQ via docker compose
bun dev              # verify (typecheck + lint) then start with --watch
```

The service boots against the committed `.env.local` with zero extra config.
The only routes mounted are the health probes — add your own feature routes as
described below. API docs (non-prod): http://localhost:3001/apidocs

## Layout

```
src/
├── index.ts                 # entry — telemetry-first bootstrap + startup guard
├── main.ts                  # connect deps (fail-fast) → server → graceful shutdown
├── instrumentation.ts       # OpenTelemetry setup (optional, OTEL_ENABLED)
├── config/                  # env validation (TypeBox) + constants (cache TTLs, RMQ topology)
├── http/
│   ├── server.ts            # pure wiring: middleware → health → /v1 feature groups
│   ├── middleware/          # logging/request-context, error boundary, requireAuth, requireCMS, body-limit
│   ├── routes/              # route factories taking deps as arguments (DI by argument)
│   └── schemas/             # TypeBox models + response envelopes
├── domain/                  # YOUR business logic goes here (pure; no Elysia imports)
│   └── interfaces/          # ports implemented by infrastructure (e.g. FileStorage)
├── infrastructure/
│   ├── composition-root.ts  # the one place that wires ports → repositories → use cases
│   ├── db/                  # Bun.SQL read/write pools, Drizzle, migrations, drizzle.config.ts
│   ├── repositories/        # repository implementations (add yours)
│   ├── cache/               # Bun-native Redis read/write clients (SCAN-based, lock/incr/zset)
│   ├── rmq/                 # RabbitMQ connection (reconnect + leak guards); consumers registry
│   └── s3/                  # Bun-native S3 client + upload/delete helpers
├── lib/                     # logger (pino + request-context mixin), shutdown, datetime, result, tracing
└── types/                   # shared types (e.g. JWT/auth user shape)
```

## What's wired vs. what's yours

- **Wired and working:** env validation, HTTP server, health/readiness/liveness
  probes, request logging + correlation IDs, global error boundary, two-tier
  body-size limit, JWT verification (`requireAuth` / `requireCMS`), Postgres
  read/write pools, Redis read/write clients, RabbitMQ connection with
  auto-reconnect, S3 helpers (`infrastructure/s3`), OpenTelemetry, and graceful
  shutdown.
- **Yours to add:** everything under `src/domain/` (entities, use cases),
  `src/infrastructure/db/tables/` (Drizzle tables) and `repositories/`
  (implementations), feature routes/schemas under `src/http/`, and RMQ
  consumers. Each barrel/registry file marks the spot with a comment.

## Adding a feature (the loop)

1. Define a Drizzle table in `src/infrastructure/db/tables/` and export it from
   `tables/index.ts`; run `bun run db:generate` then `bun run db:migrate`.
2. Write the domain port + use cases under `src/domain/<feature>/`.
3. Implement the repository in `src/infrastructure/repositories/` and export it
   from `repositories/index.ts`.
4. Wire repository → use cases in `src/infrastructure/composition-root.ts`.
5. Add a route factory in `src/http/routes/`, export it from `routes/index.ts`,
   and mount it in `src/http/server.ts`.

## Conventions

- **Functional style** — factory functions returning object literals; no classes
  (sole exception: `AppError extends Error`).
- **DI by arguments** — route factories receive `deps` (`createXRoutes(deps)`);
  never `.decorate` for dependencies (decorations don't cross instance
  boundaries in Elysia's type system).
- **Access level per route group** — `public` (no plugin) / `private`
  (`.use(requireAuth)`) / `admin` (`.use(requireCMS)`). Auth is never global.
- **JWT** — this service only **verifies** tokens (HS256 shared secret;
  signature + exp + payload shape; **no iss/aud** by default). It does not sign.
- **Datetime** — UTC ISO-8601 strings via `lib/datetime.ts` only.
- **Result type** — `lib/result.ts` for expected/recoverable failures instead of
  throwing.

## Health & probes (unversioned)

| Path | Meaning | Codes |
|---|---|---|
| `/health` | full status + per-dependency detail | 200 healthy/degraded · 503 unhealthy (DB down) |
| `/health/ready` | readiness — gates on **DB only** | 200 ready · 503 not ready |
| `/health/live` | liveness — checks **no** dependencies | always 200 |

These are the only routes the starter mounts. Redis/RabbitMQ are *optional*
services: down ⇒ `degraded`, never `unhealthy`/unready.

## Environment

Required: `WRITE_DB_*`, `READ_DB_*`, `WRITE_REDIS_URL`, `READ_REDIS_URL`,
`RABBITMQ_URL`, `JWT_SECRET` (≥32 chars), `S3_*`. Optional: `GRPC_CLIENT_URL`,
`OTEL_*`, `ENABLE_OPENAPI`, `LOG_LEVEL`, `DEPLOY_ENV` (`local|dev|stage|uat|prod`).

Committed templates: `.env.local` (works with `deps:up`), `.env.development`,
`.env.test` (`NODE_ENV=test` does not load `.env.local`). In production, all env
vars are injected by the platform — there is no committed `.env.production`.

## Commands

```bash
bun dev               # verify + watch mode
bun run verify        # typecheck + biome (the build gate)
bun run db:generate|db:migrate|db:push|db:studio   # drizzle-kit (config in src/infrastructure/db/)
bun run deps:up|deps:down|deps:logs|deps:reset     # local infra (Postgres/Redis/RabbitMQ)
```

## Docker

```bash
docker build -t app-service .   # static gate runs inside the build
```

Multi-stage build → distroless runtime; Drizzle migrations apply on startup in
production. No env file is baked into the image — inject all production env vars
via your platform's secret manager.

## License

MIT — do whatever you want.
