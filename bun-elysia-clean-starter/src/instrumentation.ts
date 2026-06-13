import {
  DiagConsoleLogger,
  DiagLogLevel,
  diag,
  trace,
} from "@opentelemetry/api";
import { env } from "./config/env";

/**
 * OpenTelemetry instrumentation. TRACES ONLY — metrics are intentionally not
 * exported; per-request traces are what this service needs, and host/process
 * health is better covered by server-level monitoring. Traces are exported
 * via OTLP (gRPC or HTTP/protobuf, selected by OTEL_EXPORTER_OTLP_PROTOCOL) to
 * any compatible collector / backend.
 *
 * Why manual OTel rather than a Node tracing agent: most agents hook
 * node:http, which Bun.serve (fetch-based) never touches, so no transactions
 * are captured on Bun. The Elysia OpenTelemetry plugin instruments requests via
 * lifecycle hooks instead, and infra spans come from the manual trace*
 * helpers in lib/tracing.ts.
 *
 * TELEMETRY IS STRICTLY OPTIONAL — nothing in this module may take the
 * service down:
 *   - Module load is safe: only @opentelemetry/api (tiny, dependency-free)
 *     is imported statically. The SDK, exporters, instrumentations and the
 *     Elysia plugin are ALL dynamically imported inside the try below, so
 *     even a broken OTel install cannot crash boot.
 *   - Init is failure-isolated: any error logs and returns null; the app
 *     boots and serves identically without telemetry.
 *   - Health probe requests (/health, /health/ready, /health/live) are
 *     excluded via checkIfShouldTrace — zero span overhead for LB/k8s
 *     probes, and no probe noise drowning out real transactions.
 *   - Head sampling via OTEL_TRACES_SAMPLE_RATE (ParentBased + ratio):
 *     turn it down under load without a deploy. Parent decisions are
 *     respected so distributed traces stay intact.
 *   - BatchSpanProcessor with a bounded queue: under burst it DROPS spans
 *     instead of growing memory; exports fail fast (10s) so a slow/down
 *     collector back-pressures nothing.
 */

function parseOtlpHeaders(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return headers;
}

/**
 * Health probes hit this service every few seconds from load balancers and
 * k8s — tracing them buys nothing and costs a span pipeline pass per probe.
 * Matched against the exact paths served by health.routes.ts.
 */
const PROBE_PATHS = new Set([
  "/health",
  "/health/",
  "/health/ready",
  "/health/live",
]);

const shouldTraceRequest = (req: Request): boolean => {
  // Runs on EVERY request — must never throw into the request path.
  try {
    const url = req.url;
    const pathStart = url.indexOf("/", url.indexOf("://") + 3);
    if (pathStart === -1) return true;
    const queryStart = url.indexOf("?", pathStart);
    const path = url.slice(
      pathStart,
      queryStart === -1 ? undefined : queryStart,
    );
    return !PROBE_PATHS.has(path);
  } catch {
    return true;
  }
};

/**
 * Creates the OpenTelemetry Elysia plugin (or null when disabled/failed —
 * the caller must treat null as "run without telemetry", never as an error).
 *
 * Everything OTel is imported HERE, not at module top, so an import-time
 * failure anywhere in the OTel stack is caught by this try and degrades to
 * "no telemetry" instead of a boot crash.
 *
 * Export protocols via OTEL_EXPORTER_OTLP_PROTOCOL:
 *   - `grpc` — OTLP/gRPC intake (collector or backend that accepts it)
 *   - `http/protobuf` — OTel Collector or compatible backends
 *
 * NO auto-instrumentations by design. Module monkey-patching
 * (require-in-the-middle) is flaky/leak-prone on Bun, and
 * our drivers are Bun-native (Bun.SQL, Bun Redis) — nothing to patch.
 * Request spans come from the Elysia plugin's lifecycle hooks; infra spans
 * come from the manual traceDb/traceCache/traceRmq/traceGrpc/traceHttp
 * helpers in src/lib/tracing.ts.
 */
export const createTelemetryPlugin = async () => {
  if (!env.OTEL_ENABLED) {
    console.info("[OTEL] Disabled - OTEL_ENABLED is false");
    return null;
  }

  try {
    // Route OTel SDK-internal errors to console instead of throwing —
    // exporter failures (e.g. collector down) must never crash the process.
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

    const [
      { opentelemetry },
      {
        envDetector,
        processDetector,
        resourceFromAttributes,
        serviceInstanceIdDetector,
      },
      { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler },
    ] = await Promise.all([
      import("@elysiajs/opentelemetry"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/sdk-trace-node"),
    ]);

    const baseEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const protocol = env.OTEL_EXPORTER_OTLP_PROTOCOL;
    const headers = parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);

    console.info(
      `[OTEL] Enabled - protocol: ${protocol}, endpoint: ${baseEndpoint}, sample rate: ${env.OTEL_TRACES_SAMPLE_RATE}`,
    );

    const resource = resourceFromAttributes({
      "service.name": env.SERVICE_NAME,
      "service.version": env.SERVICE_VERSION,
      "deployment.environment": env.DEPLOY_ENV,
    });

    let traceExporter: ConstructorParameters<typeof BatchSpanProcessor>[0];

    if (protocol === "grpc") {
      const [{ OTLPTraceExporter }, { Metadata, credentials }] =
        await Promise.all([
          import("@opentelemetry/exporter-trace-otlp-grpc"),
          import("@grpc/grpc-js"),
        ]);

      // gRPC exporters require Metadata for auth — plain headers objects are
      // not supported on this transport.
      const metadata = new Metadata();
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          metadata.add(key, value);
        }
      }

      // gRPC exporters handle service paths internally — pass base URL only.
      traceExporter = new OTLPTraceExporter({
        url: baseEndpoint,
        credentials: credentials.createInsecure(),
        metadata,
      });
    } else {
      const { OTLPTraceExporter } = await import(
        "@opentelemetry/exporter-trace-otlp-proto"
      );
      // http/protobuf requires explicit path segments.
      traceExporter = new OTLPTraceExporter({
        url: `${baseEndpoint}/v1/traces`,
        ...(headers && { headers }),
      });
    }

    const plugin = opentelemetry({
      serviceName: env.SERVICE_NAME,
      resource,
      // Exclude hostDetector: on Linux it reads /etc/machine-id
      // asynchronously, causing "resource attributes before async attributes
      // settled" warnings.
      resourceDetectors: [
        envDetector,
        processDetector,
        serviceInstanceIdDetector,
      ],
      checkIfShouldTrace: shouldTraceRequest,
      // Head sampling. ParentBased keeps distributed traces consistent:
      // if an upstream service sampled the trace, we follow its decision and
      // only apply the ratio to traces that start here.
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(env.OTEL_TRACES_SAMPLE_RATE),
      }),
      spanProcessors: [
        new BatchSpanProcessor(traceExporter, {
          maxQueueSize: 1024,
          maxExportBatchSize: 256,
          scheduledDelayMillis: 5000,
          exportTimeoutMillis: 10000,
        }),
      ],
    });

    return plugin;
  } catch (err) {
    console.error(
      "[OTEL] Failed to initialize telemetry plugin, continuing without it:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
};

export type TelemetryPlugin = Awaited<ReturnType<typeof createTelemetryPlugin>>;

/**
 * Flush and shut down the tracer provider so buffered spans are exported
 * before the process exits. Safe to call when telemetry never started
 * (no-ops). Callers should time-box this — if the collector is down,
 * shutdown must not wait on it.
 */
export const shutdownTelemetry = async () => {
  try {
    const tracerProvider = trace.getTracerProvider();
    if ("shutdown" in tracerProvider) {
      await (tracerProvider as { shutdown: () => Promise<void> }).shutdown();
    }

    console.info("[OTEL] Telemetry providers shut down");
  } catch (err) {
    console.error(
      "[OTEL] Error shutting down telemetry:",
      err instanceof Error ? err.message : err,
    );
  }
};
