import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { API_PREFIX } from '../config/constants'
import { env } from '../config/env'
import type { RedisReadClient, RedisWriteClient } from '../infrastructure/cache'
import type { compose } from '../infrastructure/composition-root'
import type { RabbitMQClient } from '../infrastructure/rmq'
import type { createTelemetryPlugin } from '../instrumentation'
import { openApiConfig } from '../openapi/config'
import { globalMiddleware } from './middleware'
import { createHealthRoutes } from './routes'
import { allModels } from './schemas/models'

// ============================================================================
// Types
// ============================================================================

export interface ServerDependencies {
  composed: ReturnType<typeof compose>
  redisReadClient: RedisReadClient
  redisWriteClient: RedisWriteClient
  rabbitmq?: RabbitMQClient
  telemetryPlugin?: Awaited<ReturnType<typeof createTelemetryPlugin>>
}

export interface ServerResult {
  // Elysia's instance type carries deep generics; `any` here mirrors the
  // upstream pattern and keeps this wiring file decoupled from route types.
  app: Elysia<any, any, any, any, any, any, any>
}

// ============================================================================
// Server Factory
// ============================================================================

/**
 * Create and configure the Elysia HTTP server. All dependency wiring is handled
 * by the composition root — this function only deals with HTTP concerns (routes,
 * middleware, plugins). The starter mounts only the health probes; add your
 * feature route groups to `apiRoutes`.
 */
export const createServer = (deps: ServerDependencies): ServerResult => {
  const { composed, redisReadClient, redisWriteClient, rabbitmq, telemetryPlugin } = deps

  // Versioned API surface. The starter mounts no feature routes — add your
  // route groups here, passing each its use cases from `composed`, e.g.:
  //   .use(createExampleRoutes({ useCases: composed.exampleUseCases }))
  void composed
  const apiRoutes = new Elysia({ name: 'api-routes', prefix: API_PREFIX })

  const app = new Elysia({ name: 'app-server' })
    .model(allModels)
    .use((app) => {
      if (!telemetryPlugin) return app
      try {
        return app.use(telemetryPlugin)
      } catch (err) {
        console.error(
          '[OTEL] Failed to register telemetry plugin with HTTP server, continuing without it:',
          err instanceof Error ? (err as Error).message : err,
        )
        return app
      }
    })
    .use(createHealthRoutes({ redisReadClient, redisWriteClient, rabbitmq }))
    .use(globalMiddleware)
    .use(apiRoutes)
    .use((app) => (env.ENABLE_OPENAPI ? app.use(openapi(openApiConfig)) : app))

  return { app }
}

export type App = ReturnType<typeof createServer>['app']
