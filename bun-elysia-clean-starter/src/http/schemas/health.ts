import { t } from "elysia";
import { failureResponse, successResponse } from "./common";

/** Status of a single dependency, with check latency where measured. */
export const serviceStatusSchema = t.Object({
  status: t.Union([t.Literal("up"), t.Literal("down")]),
  latency: t.Optional(t.Number()),
});

/** Database status (write + read pools). */
export const databaseStatusSchema = t.Object({
  status: t.Union([t.Literal("up"), t.Literal("down")]),
  write: t.String(),
  read: t.String(),
});

/** Full health check payload. */
export const healthCheckDataSchema = t.Object({
  healthStatus: t.Union([
    t.Literal("healthy"),
    t.Literal("degraded"),
    t.Literal("unhealthy"),
  ]),
  service: t.String(),
  version: t.String(),
  timestamp: t.String(),
  services: t.Object({
    database: databaseStatusSchema,
    // Optional services — reported when wired (degraded, not unhealthy).
    redis: t.Optional(serviceStatusSchema),
    rabbitmq: t.Optional(serviceStatusSchema),
  }),
});

/** K8s probe payload (ready / live). */
export const healthProbeDataSchema = t.Object({
  probeStatus: t.String(),
  timestamp: t.String(),
});

/**
 * Per-route response schemas for the health endpoints.
 * 503 entries are deliberate: orchestrators/load balancers decide by HTTP
 * status code, never by parsing the body.
 */
export const healthRouteSchemas = {
  check: {
    response: {
      200: successResponse(healthCheckDataSchema),
      503: failureResponse(healthCheckDataSchema),
    },
  },
  ready: {
    response: {
      200: successResponse(healthProbeDataSchema),
      503: failureResponse(healthProbeDataSchema),
    },
  },
  live: {
    response: { 200: successResponse(healthProbeDataSchema) },
  },
} as const;
