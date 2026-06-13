import { createPinoLogger } from "@bogeychan/elysia-logger";
import { trace } from "@opentelemetry/api";
import { env, isDev } from "../config/env";
import { getRequestContext } from "./request-context";

/**
 * Current OTel trace/span ids, when a span is active. Emitted as trace_id /
 * span_id so a log backend can correlate these log lines with the matching
 * trace. When OTEL is disabled there is never an active span and this
 * contributes nothing.
 */
const getTraceContext = (): { trace_id?: string; span_id?: string } => {
  // Runs on every log call — an OTel hiccup must never break logging.
  try {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const { traceId, spanId } = span.spanContext();
    return { trace_id: traceId, span_id: spanId };
  } catch {
    return {};
  }
};

/**
 * Shared application logger (Pino under the hood).
 *
 * - Level is driven by env.LOG_LEVEL (trace | debug | info | warn | error | fatal).
 * - Dev: human-readable, colorized output via pino-pretty.
 * - Prod: raw single-line JSON to stdout (let the container/collector ship it).
 * - Sensitive values are redacted from any logged object.
 *
 * Usable standalone (import { logger }) anywhere, and also wired into Elysia
 * routes as the request logger plugin.
 */
export const logger = createPinoLogger({
  level: env.LOG_LEVEL,

  // Inject the current request's context (requestId, ip, userId, userType)
  // plus OTel trace/span ids into every log line automatically —
  // the basis for log↔trace correlation in your observability backend.
  mixin() {
    const ctx = getRequestContext();
    return { ...ctx, ...getTraceContext() };
  },

  // Attached to every log line so logs are filterable by service/env.
  base: {
    service: env.SERVICE_NAME,
    version: env.SERVICE_VERSION,
    deployEnv: env.DEPLOY_ENV,
  },

  // Never leak secrets if a config/request object is logged.
  // Pino uses fast-redact paths: `*` matches one whole key segment, NOT a
  // substring — so wildcards like `*_PASS` do not work. Top-level secret keys
  // must be listed explicitly; `*.x` covers `x` nested one level under any key.
  redact: {
    paths: [
      // request headers
      "req.headers.authorization",
      "req.headers.cookie",
      // common nested secret keys (one level deep under any parent)
      "*.password",
      "*.pass",
      "*.token",
      "*.secret",
      "*.authorization",
      // top-level env/config secret keys
      "WRITE_DB_PASS",
      "READ_DB_PASS",
      "JWT_SECRET",
      "WRITE_REDIS_URL",
      "READ_REDIS_URL",
      "RABBITMQ_URL",
      "OTEL_EXPORTER_OTLP_HEADERS",
      "password",
      "pass",
      "token",
      "secret",
    ],
    censor: "[redacted]",
  },

  // Pretty terminal output in dev only; production stays as JSON for log shippers.
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname,service,version,deployEnv",
        messageFormat: "{msg}",
      },
    },
  }),
});

/**
 * Create a namespaced child logger that tags every line with `module`.
 * Use one per subsystem so logs are easy to filter, e.g.:
 *   const log = childLogger("db");
 *   log.info("connected");
 */
export const childLogger = (module: string) => logger.child({ module });

export type Logger = typeof logger;
