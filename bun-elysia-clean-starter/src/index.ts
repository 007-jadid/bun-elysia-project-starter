import type { TelemetryPlugin } from "./instrumentation";

// Telemetry FIRST: the auto-instrumentations (http/undici/grpc) registered
// inside createTelemetryPlugin must hook their modules before anything else
// imports them — which is why main.ts (and every infrastructure module it
// pulls in) is loaded dynamically afterwards. A null plugin means "telemetry
// off/failed" — the app boots and serves identically. Even the import is
// guarded (type import above is erased at compile time): telemetry being
// broken — bad install, incompatible OTel update — must never block boot.
let telemetryPlugin: TelemetryPlugin = null;
try {
  const { createTelemetryPlugin } = await import("./instrumentation");
  telemetryPlugin = await createTelemetryPlugin();
} catch (err) {
  console.error(
    "[OTEL] Instrumentation failed to load, starting without telemetry:",
    err instanceof Error ? err.message : err,
  );
}

const { startServer } = await import("./main");

// Top-level startup guard. Without this, a rejection during boot (e.g. the DB
// is unreachable) surfaces as an unhandled promise rejection — Bun then prints
// the driver's internal stack trace, which is noise to a developer. Here we log
// a single clean line and exit non-zero so orchestrators (k8s, compose) restart.
try {
  await startServer(telemetryPlugin);
} catch (err: unknown) {
  const { logger } = await import("./lib");
  const message = err instanceof Error ? err.message : String(err);
  logger.fatal({ caller: "startup" }, `Startup failed: ${message}`);
  process.exit(1);
}
