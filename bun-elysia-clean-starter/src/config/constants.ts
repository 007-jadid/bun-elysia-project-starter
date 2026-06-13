// API Versioning
export const API_VERSION = "v1";
export const API_PREFIX = `/${API_VERSION}`;

// Cache TTLs (seconds). Add feature-specific TTLs here as you build them.
export const CACHE_TTL = {
  DEFAULT: 300, // 5 minutes
} as const;

// Redis key layout. Keep every prefix HERE so key builders and their flush
// patterns can never drift apart. Example builders to copy:
//
//   entity: (id: number) => `app:entity:${id}`,
//   ENTITY_PATTERN: "app:entity:*",
export const CACHE_KEYS = {} as const;

// RabbitMQ topology. setupQueues() in infrastructure/rmq/rabbitmq.ts asserts
// these on every (re)connect. Add your exchanges/queues/routing-keys here.
export const EXCHANGE_NAMES = {
  // Shared application exchange — events flow through it.
  APP: "app-exchange",
} as const;

// Format: service-name:routing-key:queue (recommended convention).
export const QUEUE_NAMES = {} as const;

export const ROUTING_KEYS = {} as const;
