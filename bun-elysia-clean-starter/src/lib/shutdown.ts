import { logger } from "./logger";

/**
 * Minimal surface the shutdown logic needs from the server. Depending on the
 * full `Elysia` generic type breaks here: `logger.into()` enriches the instance
 * with extra `store`/`derive` generics, which aren't assignable to the bare
 * `Elysia` type under `exactOptionalPropertyTypes`. We only call `.stop()`.
 */
export type StoppableServer = {
  stop: (closeActiveConnections?: boolean) => Promise<unknown>;
};

/** A named cleanup task run during shutdown (e.g. close DB pool, Redis, RMQ). */
export type Disposable = {
  name: string;
  dispose: () => Promise<void> | void;
};

type ShutdownOptions = {
  /** The server to stop (drains in-flight requests). */
  app: StoppableServer;
  /** Resource cleanups to run after the server stops accepting requests. */
  disposables?: Disposable[];
  /** Hard deadline (ms) before the process is force-exited. Default 10s. */
  timeoutMs?: number;
};

const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

/**
 * Wire up graceful shutdown for the process.
 *
 * On SIGTERM/SIGINT (k8s rollout, Ctrl+C) it:
 *   1. stops the server (drains in-flight requests),
 *   2. runs each disposable in order (DB, Redis, RabbitMQ, ...),
 *   3. exits 0 — or force-exits 1 if cleanup exceeds `timeoutMs`.
 *
 * Also converts uncaughtException / unhandledRejection into a clean shutdown.
 * Idempotent: a second signal during shutdown is ignored.
 */
export function setupGracefulShutdown({
  app,
  disposables = [],
  timeoutMs = 10_000,
}: ShutdownOptions): void {
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) {
      logger.warn({ reason }, "Shutdown already in progress, ignoring signal");
      return;
    }
    shuttingDown = true;

    logger.info({ reason }, "Graceful shutdown started");

    // Force-exit if cleanup hangs past the deadline.
    const killTimer = setTimeout(() => {
      logger.error({ timeoutMs }, "Shutdown exceeded timeout, forcing exit");
      process.exit(1);
    }, timeoutMs);
    // Do not let this timer keep the event loop alive on its own.
    killTimer.unref();

    try {
      // 1. Stop accepting new requests; drain in-flight ones.
      await app.stop();
      logger.info("HTTP server stopped");

      // 2. Release resources in registration order.
      for (const { name, dispose } of disposables) {
        try {
          await dispose();
          logger.info({ resource: name }, "Resource closed");
        } catch (err) {
          logger.error({ resource: name, err }, "Failed to close resource");
        }
      }

      clearTimeout(killTimer);
      logger.info("Graceful shutdown complete");
      process.exit(exitCode);
    } catch (err) {
      clearTimeout(killTimer);
      logger.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      void shutdown(signal, 0);
    });
  }

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    void shutdown("uncaughtException", 1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled promise rejection");
    void shutdown("unhandledRejection", 1);
  });
}
