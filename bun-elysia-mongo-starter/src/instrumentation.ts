import { opentelemetry } from '@elysiajs/opentelemetry'
import { DiagConsoleLogger, DiagLogLevel, diag, metrics, trace } from '@opentelemetry/api'
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import {
  envDetector,
  processDetector,
  type Resource,
  resourceFromAttributes,
  serviceInstanceIdDetector,
} from '@opentelemetry/resources'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { env } from './config/env'

// Route OTEL SDK-internal errors to console instead of throwing.
// Prevents exporter failures (e.g., collector down) from crashing the process.
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)

let _meterProvider: MeterProvider | null = null

function parseOtlpHeaders(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined
  const headers: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=')
    if (idx > 0) {
      headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
    }
  }
  return headers
}

/**
 * Creates the OpenTelemetry Elysia plugin.
 *
 * Async because gRPC exporters are dynamically imported to avoid loading
 * @grpc/grpc-js at module parse time (would prevent auto-instrumentation patching).
 *
 * Supports two export protocols via OTEL_EXPORTER_OTLP_PROTOCOL:
 * - `http/protobuf` — OTEL Collector or compatible backends
 * - `grpc` — OTLP/gRPC intake (collector or backend that accepts it)
 *
 * Registers (in addition to traces):
 *   - MeterProvider + PeriodicExportingMetricReader (so metrics.ts stops hitting NoopMeter)
 *   - Auto-instrumentations for http / undici / grpc (amqplib / ioredis / mongoose / pino / runtime-node intentionally excluded — see notes below)
 */
export const createTelemetryPlugin = async () => {
  if (!env.OTEL_ENABLED) {
    console.log('[OTEL] Disabled - OTEL_ENABLED is false')
    return null
  }

  try {
    const baseEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT
    const protocol = env.OTEL_EXPORTER_OTLP_PROTOCOL
    const headers = parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS)

    console.log(`[OTEL] Enabled - protocol: ${protocol}, endpoint: ${baseEndpoint}`)

    const resource: Resource = resourceFromAttributes({
      'service.name': env.SERVICE_NAME,
      'service.version': env.SERVICE_VERSION,
      'deployment.environment': env.DEPLOY_ENV,
    })

    let traceExporter: ConstructorParameters<typeof BatchSpanProcessor>[0]
    let metricExporter: ConstructorParameters<typeof PeriodicExportingMetricReader>[0]['exporter']

    if (protocol === 'grpc') {
      // Dynamic import: loading these statically would pull in @grpc/grpc-js
      // before instrumentations can register their patching hooks.
      const [{ OTLPTraceExporter }, { OTLPMetricExporter }, { Metadata, credentials }] =
        await Promise.all([
          import('@opentelemetry/exporter-trace-otlp-grpc'),
          import('@opentelemetry/exporter-metrics-otlp-grpc'),
          import('@grpc/grpc-js'),
        ])

      // gRPC exporters require Metadata for auth — plain headers object is not supported
      const metadata = new Metadata()
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          metadata.add(key, value)
        }
      }

      // gRPC exporters handle service paths internally — pass base URL only
      traceExporter = new OTLPTraceExporter({
        url: baseEndpoint,
        credentials: credentials.createInsecure(),
        metadata,
      })
      metricExporter = new OTLPMetricExporter({
        url: baseEndpoint,
        credentials: credentials.createInsecure(),
        metadata,
      })
    } else {
      const [{ OTLPTraceExporter }, { OTLPMetricExporter }] = await Promise.all([
        import('@opentelemetry/exporter-trace-otlp-proto'),
        import('@opentelemetry/exporter-metrics-otlp-proto'),
      ])
      // http/protobuf requires explicit path segments
      traceExporter = new OTLPTraceExporter({
        url: `${baseEndpoint}/v1/traces`,
        headers,
      })
      metricExporter = new OTLPMetricExporter({
        url: `${baseEndpoint}/v1/metrics`,
        headers,
      })
    }

    // ------------------------------------------------------------------------
    // Metrics: register a global MeterProvider BEFORE any meter is requested.
    // Without this, metrics.getMeter() returns a NoopMeter and everything in
    // src/lib/metrics.ts is silently discarded.
    // ------------------------------------------------------------------------
    if (env.OTEL_METRICS_ENABLED) {
      _meterProvider = new MeterProvider({
        resource,
        readers: [
          new PeriodicExportingMetricReader({
            exporter: metricExporter,
            exportIntervalMillis: env.OTEL_METRICS_EXPORT_INTERVAL_MS,
            exportTimeoutMillis: 10000, // fail fast if collector is slow so metrics don't pile up
          }),
        ],
      })
      metrics.setGlobalMeterProvider(_meterProvider)
      console.log(
        `[OTEL] Metrics enabled - export interval: ${env.OTEL_METRICS_EXPORT_INTERVAL_MS}ms`,
      )
    }

    // ------------------------------------------------------------------------
    // Auto-instrumentations
    // - http / undici:        server & outbound HTTP (fetch) spans + context propagation
    // - grpc:                 client & server spans + trace context on gRPC metadata
    //
    // NOTE: AmqplibInstrumentation intentionally NOT included — same shape as
    // the Mongoose case (require-in-the-middle patching of a native-buffer-heavy
    // driver on Bun), and removing it is being tested as a fix for the residual
    // ~80 MB/day RSS native leak observed with flat JS heap. RMQ publish/consume
    // spans are produced manually via traceRmq() in the *.consumer.ts files and
    // publisher.ts, so trace coverage is preserved. Re-enable only after
    // confirming RSS slope is unaffected on Bun.
    //
    // NOTE: PinoInstrumentation intentionally NOT included — DevOps collects
    // logs from stdout, not via the OTEL Logs pipeline, so its log-forwarding
    // path is a no-op. Our own Pino mixin in src/lib/logger.ts already injects
    // trace_id/span_id/trace_flags via trace.getActiveSpan(), so correlation
    // works without the instrumentation. Removing it also drops one module-
    // patching surface (flaky on Bun — see bun#23493, bun#26536).
    //
    // NOTE: IORedisInstrumentation intentionally NOT included — we use Bun's
    // native RedisClient (not the ioredis package), so this instrumentation
    // matches nothing. Redis spans are emitted manually via traceCache().
    //
    // NOTE: RuntimeNodeInstrumentation intentionally NOT included — it calls
    // node:v8 getHeapSpaceStatistics which Bun doesn't implement, throwing on
    // every metric scrape. Runtime/heap metrics are collected via Bun-native
    // APIs in src/lib/metrics.ts (registerSystemMetrics) using bun:jsc heapStats
    // and process.cpuUsage() / process.uptime() instead.
    //
    // NOTE: MongooseInstrumentation intentionally NOT included — on Bun it
    // amplifies the MongoDB driver native leak (RSS grows faster than heap).
    // DB spans are produced manually via traceDb() in mongoose-manager.ts.
    // ------------------------------------------------------------------------
    const plugin = opentelemetry({
      serviceName: env.SERVICE_NAME,
      resource,
      // Exclude hostDetector: on Linux it reads /etc/machine-id asynchronously,
      // causing "Accessing resource attributes before async attributes settled" warnings.
      resourceDetectors: [envDetector, processDetector, serviceInstanceIdDetector],
      instrumentations: [
        new HttpInstrumentation(),
        new UndiciInstrumentation(),
        new GrpcInstrumentation(),
      ],
      spanProcessors: [
        new BatchSpanProcessor(traceExporter, {
          maxQueueSize: 2048,
          maxExportBatchSize: 512,
          scheduledDelayMillis: 10000,
          exportTimeoutMillis: 10000, // fail fast if collector is slow so spans don't pile up
        }),
      ],
    })

    return plugin
  } catch (err) {
    console.error(
      '[OTEL] Failed to initialize telemetry plugin, continuing without it:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * Flush and shut down trace + meter providers so buffered data is exported
 * before the process exits.
 */
export const shutdownTelemetry = async () => {
  try {
    const tracerProvider = trace.getTracerProvider()
    if ('shutdown' in tracerProvider) {
      await (tracerProvider as { shutdown: () => Promise<void> }).shutdown()
    }

    if (_meterProvider) {
      await _meterProvider.shutdown()
      _meterProvider = null
    }

    console.log('[OTEL] Telemetry providers shut down')
  } catch (err) {
    console.error('[OTEL] Error shutting down telemetry:', err instanceof Error ? err.message : err)
  }
}
