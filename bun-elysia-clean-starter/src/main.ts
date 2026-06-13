import { env, isDev, printEnvConfig } from "./config/env";
import { createServer } from "./http/server";
import {
  getRedisReadClient,
  getRedisWriteClient,
  redisDisposable,
} from "./infrastructure/cache/redis-manager";
import { compose } from "./infrastructure/composition-root";
import { applyMigrations, connectDb } from "./infrastructure/db";
import { startConsumers } from "./infrastructure/rmq/consumers";
import {
  getRabbitMQClient,
  rmqDisposable,
} from "./infrastructure/rmq/rabbitmq";
import type { TelemetryPlugin } from "./instrumentation";
import {
  type Disposable,
  logger,
  setupGracefulShutdown,
  startMemorySnapshot,
} from "./lib";

export async function startServer(telemetryPlugin?: TelemetryPlugin) {
  if (isDev) {
    printEnvConfig();
  }

  // Connect every required dependency BEFORE serving traffic — fail fast if
  // any is down. connectDb verifies both read + write pools.
  const db = await connectDb();

  // Pending migrations run before anything else touches the schema (prod
  // only — no-op in dev; see infrastructure/db/migrate.ts).
  await applyMigrations(db.writeDb);

  const [redisRead, redisWrite] = await Promise.all([
    getRedisReadClient(),
    getRedisWriteClient(),
  ]);
  const rabbitmq = await getRabbitMQClient();

  // Wire repositories + use cases (composition root).
  // Redis rides inside: the membership cache backs the join/team-status/
  // order-consumer flows.
  const composed = compose({
    db,
    redis: { read: redisRead, write: redisWrite },
  });

  // Register every RMQ consumer (see infrastructure/rmq/consumers.ts).
  startConsumers(rabbitmq, composed);

  // Released by setupGracefulShutdown AFTER the server stops, in this order:
  // RMQ first (halt message flow), then Redis, then DB. Telemetry goes LAST
  // so spans/metrics emitted during dependency teardown still get flushed —
  // and it is time-boxed: a down trace collector must not hold shutdown hostage.
  const disposables: Disposable[] = [
    rmqDisposable,
    redisDisposable,
    db,
    {
      name: "telemetry",
      dispose: async () => {
        // Best-effort flush. Dynamic import keeps main.ts free of any
        // runtime dependency on the OTel stack (type import above is
        // erased); if instrumentation never loaded this is a fast no-op.
        try {
          const { shutdownTelemetry } = await import("./instrumentation");
          await Promise.race([
            shutdownTelemetry(),
            new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
          ]);
        } catch {
          // Telemetry teardown must never block shutdown.
        }
      },
    },
  ];

  // In dev, periodically log memory usage to watch for leaks. The returned
  // disposable clears the timer on shutdown.
  // if (isDev) {
  disposables.push(startMemorySnapshot());
  // }

  const { app } = createServer({
    composed,
    writeDb: db.writeDb,
    readDb: db.readDb,
    redisRead,
    redisWrite,
    rabbitmq,
    telemetryPlugin: telemetryPlugin ?? null,
  });

  app.listen(
    {
      hostname: env.HOST,
      port: env.PORT,
      // Runtime hard cap — must admit the LARGEST allowed body (uploads).
      // The per-request 1MB/6MB tiering is enforced by bodyLimitMiddleware.
      maxRequestBodySize: env.REQUEST_BODY_UPLOAD_MAX_SIZE,
    },
    () => {
      logger.info(
        { caller: "main", host: env.HOST, port: env.PORT },
        "HTTP server started",
      );
    },
  );

  setupGracefulShutdown({ app, disposables });
}
