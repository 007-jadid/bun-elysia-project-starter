import mongoose from 'mongoose'
import { env, isDev } from '../../config/env'
import { logger, traceDb } from '../../lib'
import type { MongoConnection } from './mongoose/connect'

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Initialize Mongoose connection to MongoDB.
 * Configures connection pooling, timeouts, and event handlers.
 * Returns a MongoConnection object for dependency injection.
 */
export const connectMongo = async (): Promise<MongoConnection> => {
  // Global Mongoose defaults — must be set before any schema is used.
  // bufferCommands is also set here globally so queued-while-disconnected ops
  // don't accumulate in memory (a retained-closure leak vector on Bun).
  mongoose.set('strictQuery', true)
  mongoose.set('bufferCommands', false)
  if (!isDev) {
    mongoose.set('autoIndex', false)
    mongoose.set('autoCreate', false)
  }

  const mongooseOptions: mongoose.ConnectOptions = {
    maxPoolSize: 10,
    minPoolSize: 0, // Let idle connections close (mitigates Bun memory leak)
    maxIdleTimeMS: 30000, // Close idle connections after 30s
    family: 4, // force IPv4 — avoids IPv6 DNS surprises on some k8s networks
    connectTimeoutMS: isDev ? 30000 : 10000,
    serverSelectionTimeoutMS: isDev ? 30000 : 10000,
  }

  // Set Mongoose debug mode in development
  if (isDev) {
    mongoose.set('debug', true)
  }

  // Connection event handlers
  mongoose.connection.on('connected', () => {
    logger.info({ caller: 'mongoose' }, 'MongoDB connected')
  })

  mongoose.connection.on('error', (err) => {
    logger.error({ caller: 'mongoose', error: err.message }, 'MongoDB connection error')
  })

  mongoose.connection.on('disconnected', () => {
    logger.warn({ caller: 'mongoose' }, 'MongoDB disconnected')
  })

  const client = await mongoose.connect(env.MONGO_URI, mongooseOptions)

  return {
    client,
    disconnect: async () => {
      await mongoose.disconnect()
    },
  }
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check MongoDB connectivity.
 * Returns true if connected, false otherwise.
 */
export const checkMongoHealth = async (): Promise<boolean> => {
  try {
    const state = mongoose.connection.readyState
    // 1 = connected
    if (state !== 1) return false

    // Ping to verify actual connectivity
    await traceDb('MongoDB.ping', () => mongoose.connection.db?.admin().ping() as Promise<unknown>)
    return true
  } catch {
    return false
  }
}

/**
 * Get memory usage in MB.
 * Useful for monitoring Bun's RSS growth with MongoDB driver.
 */
export const getMemoryUsageMB = (): { rss: number; heap: number; external: number } => {
  const mem = process.memoryUsage()
  return {
    rss: Math.round(mem.rss / 1024 / 1024),
    heap: Math.round(mem.heapUsed / 1024 / 1024),
    external: Math.round(mem.external / 1024 / 1024),
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Gracefully close the MongoDB connection.
 */
export const closeMongo = async (): Promise<void> => {
  try {
    await mongoose.disconnect()
    logger.info({ caller: 'closeMongo' }, 'MongoDB connection closed gracefully')
  } catch (error) {
    logger.error(
      { caller: 'closeMongo', error: error instanceof Error ? error.message : error },
      'Error closing MongoDB connection',
    )
  }
}
