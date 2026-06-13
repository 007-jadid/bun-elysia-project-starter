import { t } from 'elysia'

/**
 * Elysia Reference Models for OpenAPI documentation.
 *
 * These models can be registered with `.model()` and referenced by name
 * in route schemas for better OpenAPI documentation and type reuse.
 *
 * Usage:
 *   new Elysia()
 *     .model(allModels)
 *     .get('/health', ..., { response: { 200: 'Health.Check' } })
 */

// ============================================================================
// Common Models
// ============================================================================

export const commonModels = {
  Error: t.Object(
    {
      status: t.Literal(false),
      message: t.String(),
      data: t.Null(),
    },
    { description: 'Standard error response' },
  ),
}

// ============================================================================
// Health Models
// ============================================================================

export const healthModels = {
  'Health.ServiceStatus': t.Object(
    {
      status: t.Union([t.Literal('up'), t.Literal('down')]),
      latency: t.Optional(t.Number({ description: 'Response time in ms' })),
    },
    { description: 'Status of an individual service' },
  ),

  'Health.DatabaseStatus': t.Object(
    {
      status: t.Union([t.Literal('up'), t.Literal('down')]),
    },
    { description: 'Database connection status' },
  ),

  'Health.Check': t.Object(
    {
      healthStatus: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('unhealthy')]),
      service: t.String({ description: 'Service name' }),
      version: t.String({ description: 'Service version' }),
      timestamp: t.String({ description: 'Check timestamp in ISO format' }),
      services: t.Object({
        database: t.Object({
          status: t.Union([t.Literal('up'), t.Literal('down')]),
        }),
        redis: t.Optional(
          t.Object({
            status: t.Union([t.Literal('up'), t.Literal('down')]),
            latency: t.Optional(t.Number()),
          }),
        ),
        rabbitmq: t.Optional(
          t.Object({
            status: t.Union([t.Literal('up'), t.Literal('down')]),
            latency: t.Optional(t.Number()),
          }),
        ),
        grpc: t.Optional(
          t.Object({
            status: t.Union([t.Literal('up'), t.Literal('down')]),
            latency: t.Optional(t.Number()),
          }),
        ),
      }),
    },
    { description: 'Full health check response' },
  ),

  'Health.Probe': t.Object(
    {
      probeStatus: t.String({
        description: 'Probe status (live, ready, not_ready)',
      }),
      timestamp: t.String({ description: 'Probe timestamp in ISO format' }),
    },
    { description: 'K8s probe response' },
  ),
}

// ============================================================================
// All Models (combined for easy registration)
// ============================================================================

export const allModels = {
  ...commonModels,
  ...healthModels,
}
