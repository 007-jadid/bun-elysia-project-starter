import { sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { env } from "../../config/env";
import type { RedisReadClient } from "../../infrastructure/cache/types";
import type { Database } from "../../infrastructure/db";
import type { RabbitMQClient } from "../../infrastructure/rmq/rabbitmq";
import { nowIso } from "../../lib";
import {
  createFailureResponse,
  createSuccessResponse,
} from "../schemas/common";
import { healthRouteSchemas } from "../schemas/health";

export interface HealthDependencies {
  /** Primary pool — checked for write availability (required service). */
  writeDb: Database;
  /** Replica pool — checked for read availability (required service). */
  readDb: Database;
  /** Optional — reported as degraded (not unhealthy) when down. */
  redisRead?: RedisReadClient | undefined;
  /** Optional — reported as degraded (not unhealthy) when down. */
  rabbitmq?: RabbitMQClient | undefined;
}

/**
 * A hung dependency must read as "down", not hang the probe until the
 * orchestrator's own timeout kills it.
 */
const PING_TIMEOUT_MS = 2_000;

const pingDb = async (db: Database): Promise<boolean> => {
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("DB ping timed out")),
          PING_TIMEOUT_MS,
        ),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
};

type ServiceStatus = { status: "up" | "down"; latency?: number };

const checkServiceHealth = async (
  checkFn: () => Promise<boolean> | boolean,
): Promise<ServiceStatus> => {
  const start = performance.now();
  try {
    const isHealthy = await checkFn();
    const latency = Math.round(performance.now() - start);
    return { status: isHealthy ? "up" : "down", latency };
  } catch {
    return { status: "down" };
  }
};

/**
 * Health / readiness / liveness routes. Mounted at the root (unversioned) so
 * load balancers and K8s probes have a stable path independent of API version.
 *
 * Status-code contract (a deliberate fix over the common 200-always bug):
 *   - orchestrators decide by HTTP status, never the body, so DB-down means 503
 *   - readiness gates on the DB only; redis/rmq are optional (degraded)
 *   - liveness never checks dependencies: a DB outage must not restart-loop pods
 */
export const createHealthRoutes = (deps: HealthDependencies) => {
  const { writeDb, readDb, redisRead, rabbitmq } = deps;

  return new Elysia({
    name: "health-routes",
    prefix: "/health",
    tags: ["health"],
  })
    .get(
      "/",
      async ({ status }) => {
        const [write, read] = await Promise.all([
          pingDb(writeDb),
          pingDb(readDb),
        ]);
        const database = {
          status: write && read ? ("up" as const) : ("down" as const),
          write: write ? "up" : "down",
          read: read ? "up" : "down",
        };

        // Optional services: cheap connection-flag checks, no network round-trip.
        const redis = redisRead
          ? await checkServiceHealth(() => redisRead.isConnected())
          : undefined;
        const rabbitmqStatus = rabbitmq
          ? await checkServiceHealth(() => rabbitmq.isConnected())
          : undefined;

        const dbUp = database.status === "up";
        const optionalServices = [redis, rabbitmqStatus].filter(
          (s): s is ServiceStatus => s !== undefined,
        );
        const optionalServicesUp = optionalServices.every(
          (svc) => svc.status === "up",
        );

        const healthStatus = !dbUp
          ? ("unhealthy" as const)
          : optionalServicesUp
            ? ("healthy" as const)
            : ("degraded" as const);

        const payload = {
          healthStatus,
          service: env.SERVICE_NAME,
          version: env.SERVICE_VERSION,
          timestamp: nowIso(),
          services: {
            database,
            ...(redis && { redis }),
            ...(rabbitmqStatus && { rabbitmq: rabbitmqStatus }),
          },
        };

        if (!dbUp) {
          return status(
            503,
            createFailureResponse(payload, "Service is unhealthy"),
          );
        }
        return createSuccessResponse(payload, "Health check completed");
      },
      {
        ...healthRouteSchemas.check,
        detail: {
          summary: "Health check",
          description:
            "Returns service health with dependency statuses. 503 when the database (required) is down; optional services (redis, rabbitmq) only degrade.",
          tags: ["health"],
        },
      },
    )
    .get(
      "/ready",
      async ({ status }) => {
        // Readiness gates on the database only (database is the only required dependency).
        const [write, read] = await Promise.all([
          pingDb(writeDb),
          pingDb(readDb),
        ]);
        const ready = write && read;
        const payload = {
          probeStatus: ready ? "ready" : "not_ready",
          timestamp: nowIso(),
        };

        if (!ready) {
          // 503 so K8s/LB pulls the pod — probes read status codes, not bodies.
          return status(
            503,
            createFailureResponse(payload, "Service is not ready"),
          );
        }
        return createSuccessResponse(payload, "Service is ready");
      },
      {
        ...healthRouteSchemas.ready,
        detail: {
          summary: "Readiness probe",
          description:
            "Kubernetes readiness probe. 200 when both DB pools are reachable, 503 otherwise.",
          tags: ["health"],
        },
      },
    )
    .get(
      "/live",
      () =>
        createSuccessResponse(
          {
            probeStatus: "live",
            timestamp: nowIso(),
          },
          "Service is live",
        ),
      {
        ...healthRouteSchemas.live,
        detail: {
          summary: "Liveness probe",
          description:
            "Kubernetes liveness probe. Always 200 while the process serves requests — deliberately checks no dependencies.",
          tags: ["health"],
        },
      },
    );
};
