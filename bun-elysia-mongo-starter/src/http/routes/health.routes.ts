import { Elysia } from 'elysia'
import { env } from '../../config/env'
import type { RedisReadClient, RedisWriteClient } from '../../infrastructure/cache'
import { checkMongoHealth, getMemoryUsageMB } from '../../infrastructure/db/mongoose-manager'
import { isGrpcServerRunning } from '../../infrastructure/grpc'
import type { RabbitMQClient } from '../../infrastructure/rmq'
import { createSuccessResponse } from '../schemas/common'
import { healthRouteSchemas } from '../schemas/health'

export interface HealthDependencies {
  redisReadClient?: RedisReadClient
  redisWriteClient?: RedisWriteClient
  rabbitmq?: RabbitMQClient
}

type ServiceStatus = { status: 'up' | 'down'; latency?: number }

const checkServiceHealth = async (
  checkFn: () => Promise<boolean> | boolean,
): Promise<ServiceStatus> => {
  const start = performance.now()
  try {
    const isHealthy = await checkFn()
    const latency = Math.round(performance.now() - start)
    return { status: isHealthy ? 'up' : 'down', latency }
  } catch {
    return { status: 'down' }
  }
}

export const createHealthRoutes = (deps: HealthDependencies = {}) => {
  const { redisReadClient, redisWriteClient, rabbitmq } = deps

  return new Elysia({ name: 'health-routes', prefix: '/health', tags: ['Health (Public)'] })

    .get(
      '/',
      async () => {
        // Check database (required service - MongoDB)
        const dbHealthy = await checkMongoHealth()
        const database = {
          status: dbHealthy ? ('up' as const) : ('down' as const),
        }

        // Check Redis (optional)
        const redisRead = redisReadClient
          ? await checkServiceHealth(() => redisReadClient.isConnected())
          : undefined

        const redisWrite = redisWriteClient
          ? await checkServiceHealth(() => redisWriteClient.isConnected())
          : undefined

        // Check RabbitMQ (optional)
        const rabbitmqStatus = rabbitmq
          ? await checkServiceHealth(() => rabbitmq.isConnected())
          : undefined

        // Check gRPC
        const grpc = await checkServiceHealth(isGrpcServerRunning)

        // Determine overall status
        const dbUp = database.status === 'up'
        const optionalServices = [redisRead, redisWrite, rabbitmqStatus, grpc].filter(Boolean)
        const optionalServicesUp =
          optionalServices.length === 0 || optionalServices.every((svc) => svc?.status === 'up')

        let healthStatus: 'healthy' | 'degraded' | 'unhealthy'
        if (!dbUp) {
          healthStatus = 'unhealthy'
        } else if (!optionalServicesUp) {
          healthStatus = 'degraded'
        } else {
          healthStatus = 'healthy'
        }

        return createSuccessResponse(
          {
            healthStatus,
            service: env.SERVICE_NAME,
            version: env.SERVICE_VERSION,
            timestamp: new Date().toISOString(),
            memory: getMemoryUsageMB(),
            services: {
              database,
              redisRead,
              redisWrite,
              rabbitmq: rabbitmqStatus,
              grpc,
            },
          },
          'Health check completed',
        )
      },
      {
        ...healthRouteSchemas.check,
        detail: {
          summary: 'Health check',
          description: 'Returns service health status with version info and dependency statuses.',
        },
      },
    )

    .get(
      '/ready',
      async () => {
        // Readiness depends on database being available (MongoDB)
        const dbHealthy = await checkMongoHealth()
        const probeStatus = dbHealthy ? 'ready' : 'not_ready'
        return createSuccessResponse(
          {
            probeStatus,
            timestamp: new Date().toISOString(),
          },
          probeStatus === 'ready' ? 'Service is ready' : 'Service is not ready',
        )
      },
      {
        ...healthRouteSchemas.ready,
        detail: {
          summary: 'Readiness probe',
          description:
            'Kubernetes readiness probe endpoint. Returns ready when database is available.',
        },
      },
    )
}
