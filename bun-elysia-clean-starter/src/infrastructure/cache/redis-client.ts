import { RedisClient as BunRedisClient } from "bun";
import { CACHE_TTL } from "../../config/constants";
import { childLogger } from "../../lib";
import type {
  RedisClient,
  RedisReadClient,
  RedisWriteClient,
  ZSetEntry,
} from "./types";

const log = childLogger("redis");

// ============================================================================
// Constants
// ============================================================================

const CONNECTION_TIMEOUT = 10_000;
const IDLE_TIMEOUT = 0; // Disabled — the keepalive ping prevents stale connections
const KEEPALIVE_INTERVAL = 60_000; // PING every 60s to keep the connection alive
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;
const COMMAND_TIMEOUT = 5_000; // For lock ops that bypass the connected check
const SCAN_COUNT = "100"; // Batch size hint for cursor-based SCAN
const ZREBUILD_CHUNK = 500; // Pairs per ZADD while rebuilding a board
const ZREBUILD_TEMP_TTL = "60"; // Orphan guard on the temp key mid-rebuild

/**
 * No-op tracing wrapper. The cache ops are pre-wired with these call sites so
 * that swapping in OTel's `traceCache` span (from lib/tracing.ts) is a
 * one-line import change when you want cache spans.
 */
const traceCache = <T>(_op: string, fn: () => Promise<T>): Promise<T> => fn();

// ============================================================================
// Internal: Create Bun Redis Client (native — zero npm packages)
// ============================================================================

interface BunClientResult {
  client: BunRedisClient;
  stopMonitor: () => void;
}

const calculateBackoff = (attempt: number): number => {
  const delay = Math.min(
    RECONNECT_BASE_DELAY * 2 ** attempt,
    RECONNECT_MAX_DELAY,
  );
  const jitter = Math.random() * 0.3 * delay;
  return delay + jitter;
};

const createBunClient = async (
  url: string,
  label: string,
): Promise<BunClientResult> => {
  const client = new BunRedisClient(url, {
    // Reconnection is owned EXCLUSIVELY by the manual scheduleReconnect loop
    // below: Bun's built-in autoReconnect gives up after maxRetries (default
    // 10), while ours retries forever with capped backoff. Running both makes
    // the onclose-driven loop race Bun's internal retries.
    autoReconnect: false,
    connectionTimeout: CONNECTION_TIMEOUT,
    idleTimeout: IDLE_TIMEOUT,
    enableOfflineQueue: true,
    enableAutoPipelining: true,
  });

  let connectionUp = false;
  let monitorInterval: ReturnType<typeof setInterval> | null = null;
  let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let closing = false;

  // Leak guards: every timer this client creates is cleared here, and the
  // `closing` flag prevents a reconnect from being scheduled after close.
  const stopMonitor = () => {
    closing = true;
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }
    if (keepaliveInterval) {
      clearInterval(keepaliveInterval);
      keepaliveInterval = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closing) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);

    const delay = calculateBackoff(reconnectAttempts);
    reconnectAttempts++;

    log.info(
      { client: label, attempt: reconnectAttempts, delayMs: Math.round(delay) },
      "Scheduling Redis reconnection",
    );

    reconnectTimer = setTimeout(async () => {
      if (closing) return;
      try {
        await client.connect();
      } catch {
        log.warn(
          { client: label, attempt: reconnectAttempts },
          "Redis reconnection attempt failed, retrying...",
        );
        scheduleReconnect();
      }
    }, delay);
  };

  client.onconnect = () => {
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (connectionUp || monitorInterval) {
      log.info({ client: label }, "Redis reconnected");
    } else {
      log.info({ client: label }, "Redis connected");
    }
    connectionUp = true;

    if (!monitorInterval) {
      monitorInterval = setInterval(() => {
        if (connectionUp && !client.connected) {
          connectionUp = false;
          log.warn(
            { client: label },
            "Redis connection lost, attempting to reconnect...",
          );
        }
      }, 3_000);
    }

    // Keepalive: periodic PING prevents idle disconnection by server/network.
    if (!keepaliveInterval) {
      keepaliveInterval = setInterval(() => {
        if (client.connected) {
          client.send("PING", []).catch(() => {});
        }
      }, KEEPALIVE_INTERVAL);
    }
  };

  client.onclose = (error) => {
    connectionUp = false;
    if (error) {
      log.error(
        { client: label, error: error.message },
        "Redis connection closed with error",
      );
    } else {
      log.info({ client: label }, "Redis connection closed");
    }

    if (!closing) {
      scheduleReconnect();
    }
  };

  await client.connect();

  return { client, stopMonitor };
};

// ============================================================================
// Shared command implementations
// ============================================================================
// Cache failures must degrade (return null/false/0), never break a request —
// callers fall back to the database. This swallow-errors design is deliberate
// and covered by tests.

/**
 * Cursor-based SCAN. Deliberately NOT the `KEYS` command: KEYS is
 * O(keyspace) and blocks the whole (shared) Redis server while it runs —
 * Redis docs forbid it in production. SCAN iterates in non-blocking batches.
 */
const scanKeys = async (
  client: BunRedisClient,
  pattern: string,
): Promise<string[]> => {
  const found: string[] = [];
  let cursor = "0";
  do {
    const reply = (await client.send("SCAN", [
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      SCAN_COUNT,
    ])) as [string, string[]];
    cursor = reply[0];
    found.push(...reply[1]);
  } while (cursor !== "0");
  return found;
};

const readOps = (client: BunRedisClient): RedisReadClient => ({
  async get<T>(key: string): Promise<T | null> {
    return traceCache("get", async () => {
      if (!client.connected) return null;
      try {
        const result = await client.get(key);
        if (result === null) return null;
        return JSON.parse(result) as T;
      } catch {
        return null;
      }
    });
  },

  async exists(key: string): Promise<boolean> {
    return traceCache("exists", async () => {
      if (!client.connected) return false;
      try {
        return await client.exists(key);
      } catch {
        return false;
      }
    });
  },

  async keys(pattern: string): Promise<string[]> {
    return traceCache("keys", async () => {
      if (!client.connected) return [];
      try {
        return await scanKeys(client, pattern);
      } catch {
        return [];
      }
    });
  },

  async zRevRangeWithScores(
    key: string,
    start = 0,
    stop = -1,
  ): Promise<ZSetEntry[] | null> {
    return traceCache("zRevRangeWithScores", async () => {
      if (!client.connected) return null;
      try {
        // Bun's client decodes WITHSCORES as [member, score] pairs with the
        // score already a number: [["7", 300], ["4", 150]], highest first.
        const reply = (await client.send("ZREVRANGE", [
          key,
          String(start),
          String(stop),
          "WITHSCORES",
        ])) as Array<[string, number]>;
        // Empty also means "missing": Redis deletes empty zsets, so there is
        // no observable difference — callers rebuild either way.
        if (!Array.isArray(reply) || reply.length === 0) return null;
        const entries: ZSetEntry[] = [];
        for (const pair of reply) {
          if (!Array.isArray(pair)) return null;
          const [member, rawScore] = pair;
          const score = Number(rawScore);
          if (typeof member !== "string" || !Number.isFinite(score)) {
            return null;
          }
          entries.push({ member, score });
        }
        return entries;
      } catch {
        return null;
      }
    });
  },

  async zScore(key: string, member: string): Promise<number | null> {
    return traceCache("zScore", async () => {
      if (!client.connected) return null;
      try {
        const reply = await client.send("ZSCORE", [key, member]);
        if (reply === null || reply === undefined) return null;
        const score = Number(reply);
        return Number.isFinite(score) ? score : null;
      } catch {
        return null;
      }
    });
  },

  async zCountGreater(key: string, score: number): Promise<number | null> {
    return traceCache("zCountGreater", async () => {
      if (!client.connected) return null;
      try {
        // "(score" = exclusive lower bound: members STRICTLY above `score`.
        // +1 by the caller gives RANK() semantics (ties share a rank).
        // ZCOUNT on a missing key returns 0 — callers must pair this with a
        // zScore null-check so a missing board still reads as "rebuild".
        const reply = await client.send("ZCOUNT", [key, `(${score}`, "+inf"]);
        return typeof reply === "number" ? reply : null;
      } catch {
        return null;
      }
    });
  },

  async close(): Promise<void> {
    // Overridden by the factories below (needs stopMonitor in scope).
  },

  isConnected(): boolean {
    return client.connected;
  },
});

const writeOps = (client: BunRedisClient): RedisWriteClient => ({
  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number = CACHE_TTL.DEFAULT,
  ): Promise<void> {
    return traceCache("set", async () => {
      if (!client.connected) return;
      try {
        const serialized = JSON.stringify(value);
        if (ttlSeconds > 0) {
          // Single atomic command. Deliberately NOT SET-then-EXPIRE:
          // a crash between those two round trips leaves a key with no TTL,
          // cached forever.
          await client.send("SET", [key, serialized, "EX", String(ttlSeconds)]);
        } else {
          await client.set(key, serialized);
        }
      } catch {
        // Ignore errors — cache write failure must not break the request.
      }
    });
  },

  async del(key: string): Promise<void> {
    return traceCache("del", async () => {
      if (!client.connected) return;
      try {
        await client.del(key);
      } catch {
        // Ignore errors
      }
    });
  },

  async expire(key: string, ttlSeconds: number): Promise<void> {
    return traceCache("expire", async () => {
      if (!client.connected) return;
      try {
        await client.expire(key, ttlSeconds);
      } catch {
        // Ignore errors
      }
    });
  },

  async flushPattern(pattern: string): Promise<number> {
    return traceCache("flushPattern", async () => {
      if (!client.connected) return 0;
      try {
        const matchingKeys = await scanKeys(client, pattern);
        if (matchingKeys.length === 0) return 0;
        const result = await client.send("DEL", matchingKeys);
        return typeof result === "number" ? result : 0;
      } catch {
        return 0;
      }
    });
  },

  async close(): Promise<void> {
    // Overridden by the factories below.
  },

  isConnected(): boolean {
    return client.connected;
  },

  async acquireLock(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    return traceCache("acquireLock", async () => {
      // enableOfflineQueue queues commands during reconnection, so skip the
      // connected check — send and let it queue, bounded by a timeout.
      const attempt = (): Promise<boolean> =>
        Promise.race([
          client
            .send("SET", [key, value, "NX", "EX", String(ttlSeconds)])
            .then((r) => r === "OK"),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Lock acquire timed out")),
              COMMAND_TIMEOUT,
            ),
          ),
        ]);

      try {
        return await attempt();
      } catch {
        // First attempt failed — wait for autoReconnect and retry once.
        await new Promise((r) => setTimeout(r, 2_000));
        try {
          return await attempt();
        } catch {
          return false;
        }
      }
    });
  },

  async releaseLock(key: string, value: string): Promise<boolean> {
    return traceCache("releaseLock", async () => {
      try {
        // Compare-and-delete: only the lock owner may release.
        const script =
          "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
        const result = await Promise.race([
          client.send("EVAL", [script, "1", key, value]),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Lock release timed out")),
              COMMAND_TIMEOUT,
            ),
          ),
        ]);
        return result === 1;
      } catch {
        return false;
      }
    });
  },

  async incr(key: string, ttlSeconds: number): Promise<number> {
    return traceCache("incr", async () => {
      if (!client.connected) return 0;
      try {
        // Atomic: increment, and set TTL only on first call so the window is
        // fixed from t=0.
        const script =
          "local c = redis.call('INCR', KEYS[1]); if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return c";
        const result = await client.send("EVAL", [
          script,
          "1",
          key,
          String(ttlSeconds),
        ]);
        return typeof result === "number" ? result : 0;
      } catch {
        return 0;
      }
    });
  },

  async zIncrByIfExists(
    key: string,
    delta: number,
    member: string,
    ttlSeconds: number,
  ): Promise<void> {
    return traceCache("zIncrByIfExists", async () => {
      if (!client.connected) return;
      try {
        // The EXISTS guard is load-bearing: a plain ZINCRBY on a missing key
        // creates a one-member board that readers would trust. Left missing,
        // the key gets a full rebuild from the DB on the next read instead.
        // EXPIRE makes the TTL sliding — active boards never expire.
        const script =
          "if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('ZINCRBY', KEYS[1], ARGV[1], ARGV[2]); redis.call('EXPIRE', KEYS[1], ARGV[3]); return 1 end return 0";
        await client.send("EVAL", [
          script,
          "1",
          key,
          String(delta),
          member,
          String(ttlSeconds),
        ]);
      } catch {
        // Ignore errors — the next rebuild restores the score from the DB.
      }
    });
  },

  async zAddNXIfExists(
    key: string,
    score: number,
    member: string,
    ttlSeconds: number,
  ): Promise<void> {
    return traceCache("zAddNXIfExists", async () => {
      if (!client.connected) return;
      try {
        // Same EXISTS guard as zIncrByIfExists (missing board stays missing
        // until a full rebuild). NX on top: if the member is somehow already
        // on the board, his real score is never overwritten.
        const script =
          "if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('ZADD', KEYS[1], 'NX', ARGV[1], ARGV[2]); redis.call('EXPIRE', KEYS[1], ARGV[3]); return 1 end return 0";
        await client.send("EVAL", [
          script,
          "1",
          key,
          String(score),
          member,
          String(ttlSeconds),
        ]);
      } catch {
        // Ignore errors — the next rebuild seats the member from the DB.
      }
    });
  },

  async zRem(key: string, member: string): Promise<void> {
    return traceCache("zRem", async () => {
      if (!client.connected) return;
      try {
        await client.send("ZREM", [key, member]);
      } catch {
        // Ignore errors
      }
    });
  },

  async zRebuild(
    key: string,
    entries: ZSetEntry[],
    ttlSeconds: number,
  ): Promise<boolean> {
    return traceCache("zRebuild", async () => {
      // An empty zset cannot exist in Redis — nothing to build, the caller
      // serves the (equally empty) SQL answer instead.
      if (entries.length === 0) return false;
      if (!client.connected) return false;
      // Build into a temp key in chunks (a members board can hold thousands
      // of entries — one giant command/script would block Redis), then swap
      // it in with RENAME+EXPIRE in one atomic Lua script: readers see the
      // old board or the complete new one, never a partial state.
      const tempKey = `${key}:rebuild-tmp`;
      try {
        await client.del(tempKey);
        for (let i = 0; i < entries.length; i += ZREBUILD_CHUNK) {
          const args = [tempKey];
          for (const { member, score } of entries.slice(
            i,
            i + ZREBUILD_CHUNK,
          )) {
            args.push(String(score), member);
          }
          await client.send("ZADD", args);
          // Orphan guard: if the process dies mid-build, the temp key
          // expires on its own instead of lingering forever.
          await client.send("EXPIRE", [tempKey, ZREBUILD_TEMP_TTL]);
        }
        const swap =
          "redis.call('RENAME', KEYS[1], KEYS[2]); redis.call('EXPIRE', KEYS[2], ARGV[1]); return 1";
        const result = await client.send("EVAL", [
          swap,
          "2",
          tempKey,
          key,
          String(ttlSeconds),
        ]);
        return result === 1;
      } catch {
        return false;
      }
    });
  },
});

const makeClose =
  (client: BunRedisClient, stopMonitor: () => void, label: string) =>
  async (): Promise<void> => {
    stopMonitor();
    try {
      client.close();
      log.info({ client: label }, "Redis connection closed gracefully");
    } catch {
      // Ignore close errors
    }
  };

// ============================================================================
// Factories
// ============================================================================

export const createRedisReadClient = async (
  url: string,
): Promise<RedisReadClient> => {
  const { client, stopMonitor } = await createBunClient(url, "reader");
  return {
    ...readOps(client),
    close: makeClose(client, stopMonitor, "reader"),
  };
};

export const createRedisWriteClient = async (
  url: string,
): Promise<RedisWriteClient> => {
  const { client, stopMonitor } = await createBunClient(url, "writer");
  return {
    ...writeOps(client),
    close: makeClose(client, stopMonitor, "writer"),
  };
};

/** Combined client — single connection for both read/write (uses write URL). */
export const createRedisClient = async (url: string): Promise<RedisClient> => {
  const { client, stopMonitor } = await createBunClient(url, "default");
  return {
    ...readOps(client),
    ...writeOps(client),
    close: makeClose(client, stopMonitor, "default"),
  };
};
