// Import and re-export OpenTelemetry utilities from Elysia plugin
import { getCurrentSpan, setAttributes } from '@elysiajs/opentelemetry'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { env } from '../config/env'
import {
  grpcCallCounter,
  grpcCallDuration,
  grpcErrorCounter,
  httpCallCounter,
  httpCallDuration,
  httpErrorCounter,
  recordCacheOperation,
  recordDbQuery,
  rmqErrorCounter,
  rmqPublishCounter,
  rmqPublishDuration,
} from './metrics'

export { getCurrentSpan, setAttributes }

const tracer = trace.getTracer(env.SERVICE_NAME)

// Helper for database operations with metrics
export const traceDb = async <T>(operation: string, fn: () => Promise<T>): Promise<T> => {
  const startTime = performance.now()
  let success = true

  try {
    const result = await tracer.startActiveSpan(`db.${operation}`, async (span) => {
      try {
        const res = await fn()
        span.setStatus({ code: SpanStatusCode.OK })
        return res
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        throw error
      } finally {
        span.end()
      }
    })
    return result
  } catch (error) {
    success = false
    throw error
  } finally {
    const duration = performance.now() - startTime
    recordDbQuery({ operation, duration, success })
  }
}

// Helper for cache operations with metrics
export const traceCache = async <T>(operation: string, fn: () => Promise<T>): Promise<T> => {
  const startTime = performance.now()

  try {
    const result = await tracer.startActiveSpan(`cache.${operation}`, async (span) => {
      try {
        const res = await fn()
        span.setStatus({ code: SpanStatusCode.OK })
        return res
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        throw error
      } finally {
        span.end()
      }
    })
    const duration = performance.now() - startTime

    // Detect cache hit/miss for 'get' operations
    const hit = operation === 'get' ? result !== null : undefined
    recordCacheOperation({ operation, hit, duration })

    return result
  } catch (error) {
    const duration = performance.now() - startTime
    recordCacheOperation({ operation, duration })
    throw error
  }
}

// Helper for rmq operations with metrics
export const traceRmq = async <T>(operation: string, fn: () => Promise<T>): Promise<T> => {
  const startTime = performance.now()

  try {
    const result = await tracer.startActiveSpan(`rmq.${operation}`, async (span) => {
      try {
        const res = await fn()
        span.setStatus({ code: SpanStatusCode.OK })
        return res
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        throw error
      } finally {
        span.end()
      }
    })
    const duration = performance.now() - startTime

    rmqPublishCounter.add(1, { operation })
    rmqPublishDuration.record(duration / 1000, { operation })

    return result
  } catch (error) {
    rmqErrorCounter.add(1, { operation })
    throw error
  }
}

// Helper for gRPC operations with metrics
export const traceGrpc = async <T>(operation: string, fn: () => Promise<T>): Promise<T> => {
  const startTime = performance.now()

  try {
    const result = await tracer.startActiveSpan(`grpc.${operation}`, async (span) => {
      try {
        const res = await fn()
        span.setStatus({ code: SpanStatusCode.OK })
        return res
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        throw error
      } finally {
        span.end()
      }
    })
    const duration = performance.now() - startTime

    grpcCallCounter.add(1, { operation })
    grpcCallDuration.record(duration / 1000, { operation })

    return result
  } catch (error) {
    grpcErrorCounter.add(1, { operation })
    throw error
  }
}

// Helper for outbound HTTP operations with metrics
export const traceHttp = async <T>(operation: string, fn: () => Promise<T>): Promise<T> => {
  const startTime = performance.now()

  try {
    const result = await tracer.startActiveSpan(`http.${operation}`, async (span) => {
      try {
        const res = await fn()
        span.setStatus({ code: SpanStatusCode.OK })
        return res
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        throw error
      } finally {
        span.end()
      }
    })
    const duration = performance.now() - startTime

    httpCallCounter.add(1, { operation })
    httpCallDuration.record(duration / 1000, { operation })

    return result
  } catch (error) {
    httpErrorCounter.add(1, { operation })
    throw error
  }
}
