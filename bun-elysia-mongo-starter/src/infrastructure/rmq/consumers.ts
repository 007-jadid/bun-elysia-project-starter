import type { Composed } from '../composition-root'
import type { RabbitMQClient } from './rabbitmq'

/**
 * Single registration point for every RMQ consumer this service runs.
 * Each consumer should register an onConnect callback so it survives broker
 * reconnects. New consumers are added HERE (and only here) — main.ts stays a
 * one-line call no matter how many queues we consume.
 *
 * The starter registers no consumers. Add yours like:
 *
 *   startExampleConsumer(rabbitmq, composed.exampleUseCases)
 *
 * See rabbitmq.ts for the connection/reconnect helper and
 * config/constants.ts for the exchange/queue/routing-key topology.
 */
export const startConsumers = (rabbitmq: RabbitMQClient, composed: Composed): void => {
  // No consumers wired yet — add them here.
  void rabbitmq
  void composed
}
