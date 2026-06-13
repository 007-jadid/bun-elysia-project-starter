import { getCurrentSpan, record, setAttributes } from "@elysiajs/opentelemetry";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { env } from "../config/env";

// Re-export the Elysia OTel utilities so feature code imports tracing
// concerns from one place (`lib`) instead of reaching into the plugin.
export { getCurrentSpan, record, setAttributes };

/**
 * Manual span helpers for infrastructure calls. Spans only — this project
 * exports no OTel metrics (only traces;
 * host/process health comes from server-level monitoring).
 *
 * This service deliberately runs NO auto-instrumentation for its drivers:
 * Bun.SQL (Postgres) and Bun's native Redis client are unpatchable by the
 * pg/ioredis instrumentation packages, and amqplib auto-instrumentation is
 * a known native-leak hazard on Bun. Wrap each infra call instead:
 *
 *   const rows = await traceDb("example.findActive", () =>
 *     readDb.select().from(examples).where(...),
 *   );
 *
 * Every helper:
 *   - opens an active child span under the current request's root span
 *     (so it nests correctly in the trace waterfall),
 *   - records the exception + ERROR status on failure (visible in your
 *     error details), and rethrows — never swallows.
 *
 * When OTEL is disabled these degrade to noop spans; the only cost is a
 * function call, so call sites never need an `if (otel)` guard. And if the
 * tracer itself ever fails, the wrapped operation still runs (untraced) —
 * telemetry must never block real work.
 */

const tracer = trace.getTracer(env.SERVICE_NAME);

const traceOperation = async <T>(
  spanName: string,
  fn: () => Promise<T>,
): Promise<T> => {
  // Distinguishes "the wrapped operation failed" (must propagate untouched)
  // from "the OTel machinery failed" (must not harm the operation).
  let fnFailed = false;

  try {
    return await tracer.startActiveSpan(spanName, async (span) => {
      try {
        const result = await fn();
        try {
          span.setStatus({ code: SpanStatusCode.OK });
        } catch {
          // Span bookkeeping is best-effort.
        }
        return result;
      } catch (error) {
        fnFailed = true;
        try {
          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(error),
          });
        } catch {
          // Span bookkeeping is best-effort.
        }
        throw error;
      } finally {
        try {
          span.end();
        } catch {
          // Span bookkeeping is best-effort.
        }
      }
    });
  } catch (error) {
    if (fnFailed) throw error;
    // The tracer itself failed before the operation ran — run it untraced.
    return fn();
  }
};

/** Trace a database query (Bun.SQL / Drizzle). */
export const traceDb = <T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> => traceOperation(`db.${operation}`, fn);

/** Trace a cache operation (Bun native Redis client). */
export const traceCache = <T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> => traceOperation(`cache.${operation}`, fn);

/** Trace a RabbitMQ operation (publish/consume handling). */
export const traceRmq = <T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> => traceOperation(`rmq.${operation}`, fn);

/** Trace an outbound gRPC client call. */
export const traceGrpc = <T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> => traceOperation(`grpc.${operation}`, fn);

/** Trace an outbound HTTP call (fetch to other services). */
export const traceHttp = <T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> => traceOperation(`http.${operation}`, fn);
