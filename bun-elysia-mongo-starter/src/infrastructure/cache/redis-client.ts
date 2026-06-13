import { RedisClient as BunRedisClient } from 'bun'
import { CACHE_TTL } from '../../config/constants'
import { logger, traceCache } from '../../lib'
import type { RedisClient, RedisReadClient, RedisWriteClient } from './types'

// ============================================================================
// Constants
// ============================================================================

const CONNECTION_TIMEOUT = 10000
const IDLE_TIMEOUT = 0 // Disable idle timeout — keepalive ping prevents stale connections
const KEEPALIVE_INTERVAL = 60000 // Ping every 60s to keep connection alive
const RECONNECT_BASE_DELAY = 1000
const RECONNECT_MAX_DELAY = 30000

// ============================================================================
// Internal: Create Bun Redis Client
// ============================================================================

interface BunClientResult {
  client: BunRedisClient
  stopMonitor: () => void
}

const calculateBackoff = (attempt: number): number => {
  const delay = Math.min(RECONNECT_BASE_DELAY * 2 ** attempt, RECONNECT_MAX_DELAY)
  const jitter = Math.random() * 0.3 * delay
  return delay + jitter
}

const createBunClient = async (url: string, label: string): Promise<BunClientResult> => {
  const client = new BunRedisClient(url, {
    autoReconnect: true,
    connectionTimeout: CONNECTION_TIMEOUT,
    idleTimeout: IDLE_TIMEOUT,
    enableOfflineQueue: true,
    enableAutoPipelining: true,
  })

  let connectionUp = false
  let monitorInterval: Timer | null = null
  let keepaliveInterval: Timer | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let closing = false

  const stopMonitor = () => {
    closing = true
    if (monitorInterval) {
      clearInterval(monitorInterval)
      monitorInterval = null
    }
    if (keepaliveInterval) {
      clearInterval(keepaliveInterval)
      keepaliveInterval = null
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const scheduleReconnect = () => {
    if (closing) return
    if (reconnectTimer) clearTimeout(reconnectTimer)

    const delay = calculateBackoff(reconnectAttempts)
    reconnectAttempts++

    logger.info(
      { caller: 'redis', client: label, attempt: reconnectAttempts, delayMs: Math.round(delay) },
      'Scheduling Redis reconnection',
    )

    reconnectTimer = setTimeout(async () => {
      if (closing) return
      try {
        await client.connect()
      } catch {
        logger.warn(
          { caller: 'redis', client: label, attempt: reconnectAttempts },
          'Redis reconnection attempt failed, retrying...',
        )
        scheduleReconnect()
      }
    }, delay)
  }

  client.onconnect = () => {
    reconnectAttempts = 0
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (connectionUp || monitorInterval) {
      logger.info({ caller: 'redis', client: label }, 'Redis reconnected')
    } else {
      logger.info({ caller: 'redis', client: label }, 'Redis connected')
    }
    connectionUp = true

    if (!monitorInterval) {
      monitorInterval = setInterval(() => {
        if (connectionUp && !client.connected) {
          connectionUp = false
          logger.warn(
            { caller: 'redis', client: label },
            'Redis connection lost, attempting to reconnect...',
          )
        }
      }, 3000)
    }

    // Keepalive: periodic PING prevents idle disconnection from server/network
    if (!keepaliveInterval) {
      keepaliveInterval = setInterval(() => {
        if (client.connected) {
          client.send('PING', []).catch(() => {})
        }
      }, KEEPALIVE_INTERVAL)
    }
  }

  client.onclose = (error) => {
    connectionUp = false
    if (error) {
      logger.error(
        { caller: 'redis', client: label, error: error.message },
        'Redis connection closed with error',
      )
    } else {
      logger.info({ caller: 'redis', client: label }, 'Redis connection closed')
    }

    if (!closing) {
      scheduleReconnect()
    }
  }

  await client.connect()

  return { client, stopMonitor }
}

// ============================================================================
// Read Client Factory
// ============================================================================

export const createRedisReadClient = async (url: string): Promise<RedisReadClient> => {
  const { client, stopMonitor } = await createBunClient(url, 'reader')

  return {
    async get<T>(key: string): Promise<T | null> {
      return traceCache('get', async () => {
        if (!client.connected) return null
        try {
          const result = await client.get(key)
          if (result === null) return null
          return JSON.parse(result) as T
        } catch {
          return null
        }
      })
    },

    async exists(key: string): Promise<boolean> {
      return traceCache('exists', async () => {
        if (!client.connected) return false
        try {
          return await client.exists(key)
        } catch {
          return false
        }
      })
    },

    async keys(pattern: string): Promise<string[]> {
      return traceCache('keys', async () => {
        if (!client.connected) return []
        try {
          const result = await client.send('KEYS', [pattern])
          return Array.isArray(result) ? (result as string[]) : []
        } catch {
          return []
        }
      })
    },

    async close(): Promise<void> {
      stopMonitor()
      try {
        client.close()
        logger.info(
          { caller: 'closeRedisReadClient', client: 'reader' },
          'Redis connection closed gracefully',
        )
      } catch {
        // Ignore close errors
      }
    },

    isConnected(): boolean {
      return client.connected
    },
  }
}

// ============================================================================
// Write Client Factory
// ============================================================================

export const createRedisWriteClient = async (url: string): Promise<RedisWriteClient> => {
  const { client, stopMonitor } = await createBunClient(url, 'writer')

  return {
    async set<T>(key: string, value: T, ttlSeconds: number = CACHE_TTL.DEFAULT): Promise<void> {
      return traceCache('set', async () => {
        if (!client.connected) return
        try {
          const serialized = JSON.stringify(value)
          await client.set(key, serialized)
          if (ttlSeconds > 0) {
            await client.expire(key, ttlSeconds)
          }
        } catch {
          // Ignore errors
        }
      })
    },

    async del(key: string): Promise<void> {
      return traceCache('del', async () => {
        if (!client.connected) return
        try {
          await client.del(key)
        } catch {
          // Ignore errors
        }
      })
    },

    async expire(key: string, ttlSeconds: number): Promise<void> {
      return traceCache('expire', async () => {
        if (!client.connected) return
        try {
          await client.expire(key, ttlSeconds)
        } catch {
          // Ignore errors
        }
      })
    },

    async flushPattern(pattern: string): Promise<number> {
      return traceCache('flushPattern', async () => {
        if (!client.connected) return 0
        try {
          const matchingKeys = await client.send('KEYS', [pattern])
          if (!Array.isArray(matchingKeys) || matchingKeys.length === 0) return 0
          const result = await client.send('DEL', matchingKeys as string[])
          return typeof result === 'number' ? result : 0
        } catch {
          return 0
        }
      })
    },

    async close(): Promise<void> {
      stopMonitor()
      try {
        client.close()
        logger.info(
          { caller: 'closeRedisWriteClient', client: 'writer' },
          'Redis connection closed gracefully',
        )
      } catch {
        // Ignore close errors
      }
    },

    isConnected(): boolean {
      return client.connected
    },

    async acquireLock(key: string, value: string, ttlSeconds: number): Promise<boolean> {
      return traceCache('acquireLock', async () => {
        // enableOfflineQueue queues commands during reconnection, so avoid
        // checking client.connected — just send the command and let it queue.
        // Wrap with a timeout to prevent hanging if reconnection takes too long.
        const attempt = (): Promise<boolean> =>
          Promise.race([
            client
              .send('SET', [key, value, 'NX', 'EX', String(ttlSeconds)])
              .then((r) => r === 'OK'),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Lock acquire timed out')), 5000),
            ),
          ])

        try {
          return await attempt()
        } catch {
          // First attempt failed — wait for autoReconnect and retry once
          await new Promise((r) => setTimeout(r, 2000))
          return await attempt()
        }
      })
    },

    async releaseLock(key: string, value: string): Promise<boolean> {
      return traceCache('releaseLock', async () => {
        try {
          const script =
            "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end"
          const result = await Promise.race([
            client.send('EVAL', [script, '1', key, value]),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Lock release timed out')), 5000),
            ),
          ])
          return result === 1
        } catch {
          return false
        }
      })
    },
  }
}

// ============================================================================
// Combined Client Factory
// ============================================================================

export const createRedisClient = async (url: string): Promise<RedisClient> => {
  const { client, stopMonitor } = await createBunClient(url, 'default')

  return {
    // Read operations
    async get<T>(key: string): Promise<T | null> {
      return traceCache('get', async () => {
        if (!client.connected) return null
        try {
          const result = await client.get(key)
          if (result === null) return null
          return JSON.parse(result) as T
        } catch {
          return null
        }
      })
    },

    async exists(key: string): Promise<boolean> {
      return traceCache('exists', async () => {
        if (!client.connected) return false
        try {
          return await client.exists(key)
        } catch {
          return false
        }
      })
    },

    async keys(pattern: string): Promise<string[]> {
      return traceCache('keys', async () => {
        if (!client.connected) return []
        try {
          const result = await client.send('KEYS', [pattern])
          return Array.isArray(result) ? (result as string[]) : []
        } catch {
          return []
        }
      })
    },

    // Write operations
    async set<T>(key: string, value: T, ttlSeconds: number = CACHE_TTL.DEFAULT): Promise<void> {
      return traceCache('set', async () => {
        if (!client.connected) return
        try {
          const serialized = JSON.stringify(value)
          await client.set(key, serialized)
          if (ttlSeconds > 0) {
            await client.expire(key, ttlSeconds)
          }
        } catch {
          // Ignore errors
        }
      })
    },

    async del(key: string): Promise<void> {
      return traceCache('del', async () => {
        if (!client.connected) return
        try {
          await client.del(key)
        } catch {
          // Ignore errors
        }
      })
    },

    async expire(key: string, ttlSeconds: number): Promise<void> {
      return traceCache('expire', async () => {
        if (!client.connected) return
        try {
          await client.expire(key, ttlSeconds)
        } catch {
          // Ignore errors
        }
      })
    },

    async flushPattern(pattern: string): Promise<number> {
      return traceCache('flushPattern', async () => {
        if (!client.connected) return 0
        try {
          const matchingKeys = await client.send('KEYS', [pattern])
          if (!Array.isArray(matchingKeys) || matchingKeys.length === 0) return 0
          const result = await client.send('DEL', matchingKeys as string[])
          return typeof result === 'number' ? result : 0
        } catch {
          return 0
        }
      })
    },

    async close(): Promise<void> {
      stopMonitor()
      try {
        client.close()
        logger.info({ caller: 'closeRedisClient' }, 'Redis connection closed gracefully')
      } catch {
        // Ignore close errors
      }
    },

    isConnected(): boolean {
      return client.connected
    },

    async acquireLock(key: string, value: string, ttlSeconds: number): Promise<boolean> {
      return traceCache('acquireLock', async () => {
        // enableOfflineQueue queues commands during reconnection, so avoid
        // checking client.connected — just send the command and let it queue.
        // Wrap with a timeout to prevent hanging if reconnection takes too long.
        const attempt = (): Promise<boolean> =>
          Promise.race([
            client
              .send('SET', [key, value, 'NX', 'EX', String(ttlSeconds)])
              .then((r) => r === 'OK'),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Lock acquire timed out')), 5000),
            ),
          ])

        try {
          return await attempt()
        } catch {
          // First attempt failed — wait for autoReconnect and retry once
          await new Promise((r) => setTimeout(r, 2000))
          return await attempt()
        }
      })
    },

    async releaseLock(key: string, value: string): Promise<boolean> {
      return traceCache('releaseLock', async () => {
        try {
          const script =
            "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end"
          const result = await Promise.race([
            client.send('EVAL', [script, '1', key, value]),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Lock release timed out')), 5000),
            ),
          ])
          return result === 1
        } catch {
          return false
        }
      })
    },
  }
}
