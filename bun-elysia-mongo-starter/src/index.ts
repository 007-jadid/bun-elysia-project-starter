// Entry point — initializes telemetry BEFORE loading app code.
// Auto-instrumentations (e.g., MongooseInstrumentation) must register their
// module-patching hooks before the target libraries are imported by the app.
import { createTelemetryPlugin } from './instrumentation'

const telemetryPlugin = await createTelemetryPlugin()

const { startApp } = await import('./main')
await startApp(telemetryPlugin)
