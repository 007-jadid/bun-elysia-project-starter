// ============================================================================
// Read-only Redis Client Interface
// ============================================================================

export interface RedisReadClient {
  get<T>(key: string): Promise<T | null>
  exists(key: string): Promise<boolean>
  keys(pattern: string): Promise<string[]>
  close(): Promise<void>
  isConnected(): boolean
}

// ============================================================================
// Write Redis Client Interface
// ============================================================================

export interface RedisWriteClient {
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
  del(key: string): Promise<void>
  expire(key: string, ttlSeconds: number): Promise<void>
  flushPattern(pattern: string): Promise<number>
  close(): Promise<void>
  isConnected(): boolean
  // Lock operations for distributed locking
  acquireLock(key: string, value: string, ttlSeconds: number): Promise<boolean>
  releaseLock(key: string, value: string): Promise<boolean>
}

// ============================================================================
// Combined Redis Client Interface (backwards compatible)
// ============================================================================

export interface RedisClient extends RedisReadClient, RedisWriteClient {
  close(): Promise<void>
  isConnected(): boolean
}
