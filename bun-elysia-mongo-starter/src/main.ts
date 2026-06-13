import { env, isDev, printEnvConfig } from "./config/env";
import { createServer } from "./http/server";
import {
  closeRedisClient,
  getRedisReadClient,
  getRedisWriteClient,
} from "./infrastructure/cache";
import { compose } from "./infrastructure/composition-root";
import {
  checkMongoHealth,
  closeMongo,
  connectMongo,
} from "./infrastructure/db/mongoose-manager";
import {
  createGrpcServer,
  startGrpcServer,
  stopGrpcServer,
} from "./infrastructure/grpc";
import {
  closeRabbitMQClient,
  createRabbitMQClient,
  startConsumers,
} from "./infrastructure/rmq";
import type { createTelemetryPlugin } from "./instrumentation";
import { shutdownTelemetry } from "./instrumentation";
import { closeLogger, logger } from "./lib";
import { registerSystemMetrics } from "./lib/metrics";

//
// Safety net: prevent observability transport errors (OTEL exporter / pino-loki)
// from crashing the service at runtime. Errors are still logged to stderr.
process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled rejection (non-fatal):", reason);
});

const MEMORY_SNAPSHOT_INTERVAL_MS = 15_000;
const toMB = (bytes: number): number => Math.round(bytes / 1024 / 1024);

const startMemorySnapshotLogger = (): ReturnType<typeof setInterval> => {
  return setInterval(() => {
    const m = process.memoryUsage();
    logger.info(
      {
        caller: "memory.snapshot",
        rss_mb: toMB(m.rss),
        heap_used_mb: toMB(m.heapUsed),
        heap_total_mb: toMB(m.heapTotal),
        external_mb: toMB(m.external),
        array_buffers_mb: toMB(m.arrayBuffers),
      },
      "memory snapshot",
    );
  }, MEMORY_SNAPSHOT_INTERVAL_MS);
};

export const startApp = async (
  telemetryPlugin: Awaited<ReturnType<typeof createTelemetryPlugin>>,
) => {
  // Print env config in development (env is already validated on import)
  if (isDev) {
    printEnvConfig();
  }

  // Register runtime/system metric observables once the global MeterProvider is set.
  // Safe to call even if OTEL is disabled — getMeter() returns a NoopMeter in that case.
  registerSystemMetrics();

  logger.info({ caller: "main", env: env.NODE_ENV }, "Starting service");

  // Memory diagnostic: periodic snapshot to identify heap vs native growth.
  const memorySnapshotTimer = startMemorySnapshotLogger();

  // Initialize MongoDB connection (fail fast if unreachable).
  const db = await connectMongo();
  const dbHealthy = await checkMongoHealth();
  if (!dbHealthy) {
    throw new Error("MongoDB connectivity check failed");
  }
  logger.info({ caller: "main" }, "MongoDB connected and verified");

  // Initialize Redis clients (read/write separation) — parallel for faster startup.
  const [redisWriteClient, redisReadClient] = await Promise.all([
    getRedisWriteClient(),
    getRedisReadClient(),
  ]);
  logger.info({ caller: "main" }, "Redis clients initialized");

  // Wire all dependencies via the composition root.
  const composed = compose({ db });

  // Initialize RabbitMQ (when configured) and register consumers.
  let rabbitmq;
  if (env.RABBITMQ_URL) {
    rabbitmq = await createRabbitMQClient();
    startConsumers(rabbitmq, composed);
    logger.info({ caller: "main" }, "RabbitMQ client initialized");
  }

  // Start gRPC server (generic Health service — add your own services in
  // infrastructure/grpc/server.ts).
  const grpcServer = await createGrpcServer();
  await startGrpcServer(grpcServer);
  logger.info({ caller: "main", port: env.GRPC_PORT }, "gRPC server started");

  // Create HTTP server.
  const { app } = createServer({
    composed,
    redisReadClient,
    redisWriteClient,
    rabbitmq,
    telemetryPlugin,
  });

  app.listen(
    {
      port: env.PORT,
      maxRequestBodySize: env.MAX_UPLOAD_SIZE, // Bun hard limit (allows file uploads)
    },
    () => {
      logger.info(
        { caller: "main", port: env.PORT, maxUploadSize: env.MAX_UPLOAD_SIZE },
        "HTTP server started",
      );
    },
  );

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    logger.info({ caller: "shutdown", signal }, "Shutdown signal received");
    try {
      clearInterval(memorySnapshotTimer);
      await app.stop();
      await stopGrpcServer(grpcServer);
      await closeRabbitMQClient();
      await closeRedisClient();
      await closeMongo();
      await shutdownTelemetry();
      await closeLogger();

      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};
