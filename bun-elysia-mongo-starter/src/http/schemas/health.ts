import { t } from 'elysia'
import { successResponse } from './common'

/**
 * Service status schema
 */
export const serviceStatusSchema = t.Object({
  status: t.Union([t.Literal('up'), t.Literal('down')]),
  latency: t.Optional(t.Number()),
})

/**
 * Database status schema
 */
export const databaseStatusSchema = t.Object({
  status: t.Union([t.Literal('up'), t.Literal('down')]),
})

/**
 * Services status schema
 */
export const servicesStatusSchema = t.Object({
  database: databaseStatusSchema,
  redisRead: t.Optional(serviceStatusSchema),
  redisWrite: t.Optional(serviceStatusSchema),
  rabbitmq: t.Optional(serviceStatusSchema),
  grpc: t.Optional(serviceStatusSchema),
})

/**
 * Health check data schema
 */
export const healthCheckDataSchema = t.Object({
  healthStatus: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('unhealthy')]),
  service: t.String(),
  version: t.String(),
  timestamp: t.String(),
  services: servicesStatusSchema,
})

/**
 * Health probe data schema
 */
export const healthProbeDataSchema = t.Object({
  probeStatus: t.String(),
  timestamp: t.String(),
})

/**
 * Route schemas
 */
export const healthRouteSchemas = {
  check: {
    response: { 200: successResponse(healthCheckDataSchema) },
  },

  ready: {
    response: { 200: successResponse(healthProbeDataSchema) },
  },

  live: {
    response: { 200: successResponse(healthProbeDataSchema) },
  },
} as const
