// Client timezone expectation (used when formatting timestamps for display).
export const CLIENT_TIMEZONE = 'UTC'

// API Versioning
export const API_VERSION = 'v1'
export const API_PREFIX = `/${API_VERSION}`

// Cache TTLs (in seconds)
export const CACHE_TTL = {
  DEFAULT: 3600, // 1 hour
} as const

// Redis Lock Settings
export const LOCK_TTL = {
  DEFAULT: 30, // 30 seconds
} as const

// RabbitMQ topology. setupQueues() in infrastructure/rmq/rabbitmq.ts asserts
// the exchange on every (re)connect. Add your queues/routing-keys as you build.
export const EXCHANGE_NAMES = {
  // Shared application exchange — events flow through it.
  APP: 'app-exchange',
} as const

export const QUEUE_NAMES = {} as const

export const ROUTING_KEYS = {} as const
