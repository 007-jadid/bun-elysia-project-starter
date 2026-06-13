import { env } from '../../config/env'
import { logger } from '../../lib'
import { createRedisClient, createRedisReadClient, createRedisWriteClient } from './redis-client'
import type { RedisClient, RedisReadClient, RedisWriteClient } from './types'

// ============================================================================
// Client Instances
// ============================================================================

let redisWriteClient: RedisWriteClient | null = null
let redisReadClient: RedisReadClient | null = null
let redisCombinedClient: RedisClient | null = null

// ============================================================================
// Client Accessors
// ============================================================================

export const getRedisWriteClient = async (): Promise<RedisWriteClient> => {
  if (!redisWriteClient) {
    redisWriteClient = await createRedisWriteClient(env.WRITE_REDIS_URL)
    logger.info({ caller: 'getRedisWriteClient' }, 'Redis write client initialized')
  }
  return redisWriteClient
}

export const getRedisReadClient = async (): Promise<RedisReadClient> => {
  if (!redisReadClient) {
    redisReadClient = await createRedisReadClient(env.READ_REDIS_URL)
    logger.info({ caller: 'getRedisReadClient' }, 'Redis read client initialized')
  }
  return redisReadClient
}

// Combined client - single connection for both read/write (uses write URL)
export const getRedisClient = async (): Promise<RedisClient> => {
  if (!redisCombinedClient) {
    redisCombinedClient = await createRedisClient(env.WRITE_REDIS_URL)
    logger.info({ caller: 'getRedisClient' }, 'Redis combined client initialized')
  }
  return redisCombinedClient
}

// ============================================================================
// Cleanup
// ============================================================================

export const closeRedisClients = async (): Promise<void> => {
  const closePromises: Promise<void>[] = []

  if (redisWriteClient) {
    closePromises.push(redisWriteClient.close())
    redisWriteClient = null
  }

  if (redisReadClient) {
    closePromises.push(redisReadClient.close())
    redisReadClient = null
  }

  if (redisCombinedClient) {
    closePromises.push(redisCombinedClient.close())
    redisCombinedClient = null
  }

  await Promise.all(closePromises)
  logger.info({ caller: 'closeRedisClients' }, 'Redis clients closed')
}

// Backwards compatible alias
export const closeRedisClient = closeRedisClients
