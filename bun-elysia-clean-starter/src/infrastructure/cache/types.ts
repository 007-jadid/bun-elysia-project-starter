// Redis client interfaces. Read/write split mirrors the DB split: the read
// client may point at a replica (READ_REDIS_URL), the write client at the
// primary (WRITE_REDIS_URL).

/** One sorted-set entry — member plus its score. */
export interface ZSetEntry {
  member: string;
  score: number;
}

export interface RedisReadClient {
  get<T>(key: string): Promise<T | null>;
  exists(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  /** Sorted-set range (default: whole set), highest score first. null = key
   * missing OR Redis down — callers treat both as "rebuild from the DB".
   * (An empty zset cannot exist in Redis, so empty also maps to null.) */
  zRevRangeWithScores(
    key: string,
    start?: number,
    stop?: number,
  ): Promise<ZSetEntry[] | null>;
  /** Member's score, or null when the member/key is absent or Redis is
   * down — callers treat null as "rebuild or fall back". */
  zScore(key: string, member: string): Promise<number | null>;
  /** How many members have a score STRICTLY greater than `score` — +1 gives
   * the RANK() rank (ties share). null = key missing or Redis down. */
  zCountGreater(key: string, score: number): Promise<number | null>;
  close(): Promise<void>;
  isConnected(): boolean;
}

export interface RedisWriteClient {
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  flushPattern(pattern: string): Promise<number>;
  close(): Promise<void>;
  isConnected(): boolean;
  /** Distributed lock: SET NX EX. Returns true if the lock was acquired. */
  acquireLock(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** Releases the lock only if `value` still owns it (Lua compare-and-delete). */
  releaseLock(key: string, value: string): Promise<boolean>;
  /** Atomic increment — sets TTL only on first call (window-based counter). */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** GUARDED sorted-set increment: applies ZINCRBY + refreshes the TTL only
   * when the key already exists; a missing key is left missing (a plain
   * ZINCRBY would create a partial one-member board that readers would
   * trust). Skipping is safe — the DB committed first and the next read
   * rebuilds the whole board. */
  zIncrByIfExists(
    key: string,
    delta: number,
    member: string,
    ttlSeconds: number,
  ): Promise<void>;
  /** GUARDED sorted-set add: ZADD NX (never overwrites an existing score) +
   * TTL refresh, only when the key already exists — same missing-key rule as
   * zIncrByIfExists. Used by the join flow to seat a new member at 0. */
  zAddNXIfExists(
    key: string,
    score: number,
    member: string,
    ttlSeconds: number,
  ): Promise<void>;
  /** Remove one member from a sorted set (no-op when absent). */
  zRem(key: string, member: string): Promise<void>;
  /** Atomically replace a sorted set with `entries` and set its TTL. Built
   * in CHUNKS into a temp key, then swapped in with one RENAME — readers
   * never observe a partial board, and a big board never blocks Redis with
   * one giant command. Returns false on failure or empty input (an empty
   * zset cannot exist in Redis). */
  zRebuild(
    key: string,
    entries: ZSetEntry[],
    ttlSeconds: number,
  ): Promise<boolean>;
}

export interface RedisClient extends RedisReadClient, RedisWriteClient {
  close(): Promise<void>;
  isConnected(): boolean;
}
