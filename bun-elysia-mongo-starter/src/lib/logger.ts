import { trace } from '@opentelemetry/api'
import type { Logger as PinoLogger, TransportTargetOptions } from 'pino'
import pino from 'pino'
import { env } from '../config/env'
import { getRequestContext } from './request-context'

/**
 * Extracts the active trace/span IDs from the global OpenTelemetry context.
 * Works across any async boundary the OTel ContextManager follows — HTTP,
 * gRPC handlers, RMQ consumer callbacks, scheduled jobs.
 *
 * Keys mirror what @opentelemetry/instrumentation-pino would inject, so your
 * APM and other backends can link logs → traces regardless of which path
 * produced them.
 */
const getOtelContext = (): { trace_id?: string; span_id?: string } => {
  const span = trace.getActiveSpan()
  if (!span) return {}
  const { traceId, spanId } = span.spanContext()
  return {
    ...(traceId && { trace_id: traceId }),
    ...(spanId && { span_id: spanId }),
  }
}

/**
 * Build Pino transport targets for cases where a worker-thread transport is
 * actually needed: dev pretty-printing, or shipping to Loki.
 *
 * In prod with Loki disabled (the default), we skip transport entirely and let
 * Pino write JSON to stdout from the main thread — no worker, no IPC, no extra
 * buffering. DevOps collects from stdout either way. See needsTransport() below.
 */
const buildTransportTargets = (): TransportTargetOptions[] => {
  const targets: TransportTargetOptions[] = [
    {
      target: env.NODE_ENV === 'development' ? 'pino-pretty' : 'pino/file',
      level: env.LOG_LEVEL,
      options: env.NODE_ENV === 'development' ? { colorize: true } : { destination: 1 }, // stdout
    },
  ]

  if (env.LOKI_ENABLED && env.LOKI_HOST) {
    targets.push({
      target: 'pino-loki',
      level: env.LOG_LEVEL,
      options: {
        host: env.LOKI_HOST,
        basicAuth: env.LOKI_BASIC_AUTH || undefined,
        labels: {
          app: env.SERVICE_NAME,
          env: env.NODE_ENV,
        },
        batching: true,
        interval: 5,
        // 🛡️ Safety: Prevent app crashes when Loki is down
        timeout: 30000, // 30s timeout - fail fast if Loki is slow
        silentErrors: true, // Don't crash worker on Loki failures
      },
    })
  }

  return targets
}

/**
 * Worker-thread transport is only worth the cost when we're pretty-printing
 * (dev) or shipping to Loki. In vanilla prod (stdout only), skip it — Pino
 * writes JSON directly from the main thread, which is what DevOps tails anyway.
 */
const needsTransport = (): boolean =>
  env.NODE_ENV === 'development' || Boolean(env.LOKI_ENABLED && env.LOKI_HOST)

const createTransport = () => {
  try {
    const transport = pino.transport({
      targets: buildTransportTargets(),
    })

    // Prevent process crash when a transport worker (e.g., pino-loki) fails
    transport.on('error', (err: Error) => {
      console.error(`Logger transport error (non-fatal): ${err.message}`)
    })

    return transport
  } catch (err) {
    console.error(
      '[Logger] Failed to create transport, falling back to direct stdout:',
      err instanceof Error ? err.message : err,
    )
    // Fall back to main-thread stdout — same as the needsTransport()=false path.
    return undefined
  }
}

/**
 * Create Pino logger instance with automatic traceId injection.
 *
 * - Main-thread JSON-to-stdout in prod (no worker, no transport IPC) — DevOps
 *   collects from stdout anyway. Removes one on-the-hot-path variable on Bun.
 * - Worker-thread transport in dev (pino-pretty) or when Loki shipping is
 *   explicitly enabled (pino-loki).
 * - Injects traceId / span_id from OpenTelemetry via mixin regardless of sink.
 */
const pinoLogger = pino(
  {
    level: env.LOG_LEVEL,
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    base: {
      service: env.SERVICE_NAME,
      version: env.SERVICE_VERSION,
      env: env.NODE_ENV,
    },
    // Redact common credential / PII fields at serialization time so accidental
    // logger.info({ headers, env, user }) calls can't leak secrets to Loki/APM.
    redact: {
      paths: [
        'password',
        '*.password',
        'token',
        '*.token',
        'authorization',
        '*.authorization',
        'headers.authorization',
        'headers.cookie',
        'req.headers.authorization',
        'req.headers.cookie',
        'body.password',
        'body.token',
        'JWT_SECRET',
        'S3_SECRET_ACCESS_KEY',
      ],
      censor: '[REDACTED]',
    },
    // Mixin: injects trace_id/span_id + request context into every log record.
    // Field names match @opentelemetry/instrumentation-pino output so your
    // APM log/trace correlation works out of the box.
    mixin() {
      const otel = getOtelContext()
      const requestContext = getRequestContext()

      return {
        ...otel,
        ...(requestContext?.requestId && {
          requestId: requestContext.requestId,
        }),
        ...(requestContext?.ip && { ip: requestContext.ip }),
        ...(requestContext?.userAgent && {
          userAgent: requestContext.userAgent,
        }),
        ...(requestContext?.userId && { userId: requestContext.userId }),
        ...(requestContext?.userType && { userType: requestContext.userType }),
      }
    },
  },
  needsTransport() ? createTransport() : undefined,
)

/**
 * Logger interface matching our application's needs
 */
export interface Logger {
  trace(dataOrMsg: Record<string, unknown> | string, msg?: string): void
  debug(dataOrMsg: Record<string, unknown> | string, msg?: string): void
  info(dataOrMsg: Record<string, unknown> | string, msg?: string): void
  warn(dataOrMsg: Record<string, unknown> | string, msg?: string): void
  error(dataOrMsg: Record<string, unknown> | string, msg?: string): void
  fatal(dataOrMsg: Record<string, unknown> | string, msg?: string): void
  child(context: Record<string, unknown>): Logger
}

/**
 * Wrapper around Pino logger to provide consistent API
 */
class LoggerWrapper implements Logger {
  constructor(private pinoInstance: PinoLogger) {}

  private log(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    dataOrMsg: Record<string, unknown> | string,
    msg?: string,
  ): void {
    if (typeof dataOrMsg === 'string') {
      this.pinoInstance[level](dataOrMsg)
    } else {
      this.pinoInstance[level](dataOrMsg, msg || '')
    }
  }

  trace(dataOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('trace', dataOrMsg, msg)
  }

  debug(dataOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('debug', dataOrMsg, msg)
  }

  info(dataOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('info', dataOrMsg, msg)
  }

  warn(dataOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('warn', dataOrMsg, msg)
  }

  error(dataOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('error', dataOrMsg, msg)
  }

  fatal(dataOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('fatal', dataOrMsg, msg)
  }

  child(context: Record<string, unknown>): Logger {
    return new LoggerWrapper(this.pinoInstance.child(context))
  }
}

/**
 * Global logger instance
 *
 * No initialization needed - Pino handles worker thread spawning automatically.
 * TraceId is automatically injected via mixin on every log call.
 */
export const logger: Logger = new LoggerWrapper(pinoLogger)

/**
 * Create a child logger with request-scoped context (e.g., requestId)
 */
export const createRequestLogger = (requestId: string): Logger => logger.child({ requestId })

/**
 * No-op for backward compatibility.
 * Pino initializes worker threads automatically - no manual init needed.
 *
 * @deprecated This function is no longer needed with simplified Pino setup
 */
export const initLogger = async (): Promise<void> => {
  // No-op: Pino handles initialization automatically
}

/**
 * Flush and close logger on shutdown.
 * Ensures all buffered logs are written before process exits.
 */
export const closeLogger = async (): Promise<void> => {
  return new Promise((resolve) => {
    pinoLogger.flush(() => {
      resolve()
    })
  })
}
