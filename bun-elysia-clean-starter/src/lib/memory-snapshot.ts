import { childLogger } from "./logger";
import type { Disposable } from "./shutdown";

const log = childLogger("memory");

const DEFAULT_INTERVAL_MS = 30_000;
const toMB = (bytes: number): number =>
  Math.round((bytes / 1024 / 1024) * 100) / 100;

type MemorySnapshotOptions = {
  /** How often to log a snapshot, in ms. Default 30s. */
  intervalMs?: number;
};

/**
 * Periodically logs process memory usage so you can watch for leaks.
 *
 * Each line includes the current RSS/heap AND the delta from the first
 * snapshot (baseline). A steadily climbing `rss_delta_mb` / `heap_used_delta_mb`
 * across many snapshots under steady load is the signature of a leak; numbers
 * that rise then settle (or sawtooth with GC) are normal.
 *
 * Returns a Disposable so the timer is cleared on graceful shutdown — push it
 * into the shutdown `disposables` array. The timer is `.unref()`'d so it never
 * keeps the process alive on its own.
 */
export function startMemorySnapshot(
  options: MemorySnapshotOptions = {},
): Disposable {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  // Bun exposes process.uptime(); avoid Date.now() so it stays simple/testable.
  let baseline: NodeJS.MemoryUsage | null = null;

  const timer = setInterval(() => {
    const m = process.memoryUsage();
    baseline ??= m;

    log.info(
      {
        uptime_s: Math.round(process.uptime()),
        rss_mb: toMB(m.rss),
        heap_used_mb: toMB(m.heapUsed),
        heap_total_mb: toMB(m.heapTotal),
        external_mb: toMB(m.external),
        array_buffers_mb: toMB(m.arrayBuffers),
        // Deltas from the first snapshot — the leak signal.
        rss_delta_mb: toMB(m.rss - baseline.rss),
        heap_used_delta_mb: toMB(m.heapUsed - baseline.heapUsed),
      },
      "memory.snapshot",
    );
  }, intervalMs);

  // Don't let the snapshot timer hold the event loop open during shutdown.
  timer.unref();

  return {
    name: "memory-snapshot",
    dispose: () => {
      clearInterval(timer);
    },
  };
}
