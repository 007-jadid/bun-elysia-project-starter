import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { API_VERSION } from "../config/constants";
import { env } from "../config/env";
import type {
  RedisReadClient,
  RedisWriteClient,
} from "../infrastructure/cache/types";
import type { Composed } from "../infrastructure/composition-root";
import type { Database } from "../infrastructure/db";
import type { RabbitMQClient } from "../infrastructure/rmq/rabbitmq";
import type { TelemetryPlugin } from "../instrumentation";
import { openApiConfig } from "../openapi/config";
import { globalMiddleware } from "./middleware/global.middleware";
import { createHealthRoutes } from "./routes";
import { allModels } from "./schemas/models";

export type ServerDeps = {
  /** All use-case groups, wired by the composition root. */
  composed: Composed;
  /** Primary — use for writes and transactions. */
  writeDb: Database;
  /** Replica — use for read-only queries. */
  readDb: Database;
  /** Redis replica — read-only cache queries. */
  redisRead: RedisReadClient;
  /** Redis primary — cache writes, locks, counters. */
  redisWrite: RedisWriteClient;
  /** RabbitMQ connection (publisher/consumer channel access). */
  rabbitmq: RabbitMQClient;
  /** OTel Elysia plugin — null when telemetry is disabled or failed init. */
  telemetryPlugin?: TelemetryPlugin | undefined;
};

/**
 * Server factory — pure wiring, zero business logic. Method chaining is kept
 * unbroken so Elysia's type inference flows through the whole instance.
 *
 * Dependency injection standard: feature route factories take deps as
 * arguments (like createHealthRoutes). Deliberately NO `.decorate` for deps —
 * decorations don't cross file/instance boundaries in Elysia's type system.
 *
 * Access levels — each feature group declares its own; auth is NEVER global:
 *   public  → no auth plugin
 *   private → .use(requireAuth) inside the group
 *   admin   → .use(requireCMS) inside the group
 */
export function createServer(deps: ServerDeps) {
  // Versioned API surface. The starter mounts no feature routes — add your
  // route groups here, passing each its use cases from `deps.composed`, e.g.:
  //   .use(createExampleRoutes({ useCases: deps.composed.exampleUseCases }))
  const v1 = new Elysia({ prefix: `/${API_VERSION}` });

  const app = new Elysia({ name: "app-server" })
    // Register reference models once; routes reference them by name.
    .model(allModels)
    // Telemetry FIRST so the request root span wraps all middleware and
    // routes. Registration is fenced: a plugin failure logs and the server
    // keeps serving untraced — telemetry must never take this service down.
    .use((app) => {
      if (!deps.telemetryPlugin) return app;
      try {
        return app.use(deps.telemetryPlugin);
      } catch (err) {
        console.error(
          "[OTEL] Failed to register telemetry plugin with HTTP server, continuing without it:",
          err instanceof Error ? err.message : err,
        );
        return app;
      }
    })
    // Request context/logging + global error boundary — before any routes so
    // every request (health included) is covered.
    .use(globalMiddleware)
    // Unversioned probes for load balancers / K8s (public).
    .use(createHealthRoutes(deps))
    // Versioned routes (empty until you add feature groups to `v1`).
    .use(v1);

  // API docs, only when enabled (off in production).
  if (env.ENABLE_OPENAPI) {
    app.use(openapi(openApiConfig));
  }

  return { app };
}

export type App = ReturnType<typeof createServer>["app"];
