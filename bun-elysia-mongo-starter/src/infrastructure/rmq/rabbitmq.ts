import amqp from 'amqplib'
import { EXCHANGE_NAMES } from '../../config/constants'
import { env } from '../../config/env'
import { logger, traceRmq } from '../../lib'

const RECONNECT_BASE_DELAY = 1000
const RECONNECT_MAX_DELAY = 30000
// Shows up in the RabbitMQ management UI — how ops tells connections apart.
const CONNECTION_NAME = env.SERVICE_NAME

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>
type AmqpChannel = Awaited<ReturnType<AmqpConnection['createChannel']>>

interface ConnectionState {
  connection: AmqpConnection | null
  channel: AmqpChannel | null
  isConnecting: boolean
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

const state: ConnectionState = {
  connection: null,
  channel: null,
  isConnecting: false,
  reconnectAttempts: 0,
  reconnectTimer: null,
}

const connectCallbacks: ConnectCallback[] = []

export type ConnectCallback = (channel: AmqpChannel) => void

export interface RabbitMQClient {
  getChannel(): AmqpChannel | null
  isConnected(): boolean
  onConnect(cb: ConnectCallback): void
  close(): Promise<void>
}

const calculateBackoff = (attempt: number): number => {
  const delay = Math.min(RECONNECT_BASE_DELAY * 2 ** attempt, RECONNECT_MAX_DELAY)
  const jitter = Math.random() * 0.3 * delay
  return delay + jitter
}

// Runs on EVERY (re)connect, so topology survives broker restarts. Asserts the
// shared exchange only; assert/bind your queues here as you add consumers, e.g.:
//   await channel.assertQueue(QUEUE_NAMES.EXAMPLE, { durable: true })
//   await channel.bindQueue(QUEUE_NAMES.EXAMPLE, EXCHANGE_NAMES.APP, ROUTING_KEYS.EXAMPLE)
const setupQueues = async (channel: AmqpChannel): Promise<void> => {
  await traceRmq('setup.assertExchange', () =>
    channel.assertExchange(EXCHANGE_NAMES.APP, 'topic', { durable: true }),
  )
}

const connect = async (): Promise<boolean> => {
  if (!env.RABBITMQ_URL) {
    return false
  }

  if (state.isConnecting) {
    return false
  }

  // Already connected — skip
  if (state.connection !== null && state.channel !== null) {
    return true
  }

  state.isConnecting = true

  try {
    const connection = await amqp.connect(env.RABBITMQ_URL, {
      clientProperties: { connection_name: CONNECTION_NAME },
    })
    const channel = await connection.createChannel()

    await setupQueues(channel)

    state.connection = connection
    state.channel = channel
    state.reconnectAttempts = 0
    state.isConnecting = false

    logger.info({ caller: 'connect' }, 'RabbitMQ connected and queues configured')

    for (const cb of connectCallbacks) {
      try {
        cb(channel)
      } catch (err) {
        logger.error(
          { caller: 'connect', error: err instanceof Error ? err.message : err },
          'Error in onConnect callback',
        )
      }
    }

    connection.on('error', (err: Error) => {
      logger.error({ caller: 'connect', error: err.message }, 'RabbitMQ connection error')
    })

    connection.on('close', () => {
      logger.warn({ caller: 'connect' }, 'RabbitMQ connection closed')
      // Detach listeners from the dead connection/channel before dropping refs.
      // amqplib retains the objects in internal maps; without this, each reconnect
      // accumulates listener closures and their captured scope (native drip on Bun).
      try {
        connection.removeAllListeners()
        channel.removeAllListeners()
      } catch {}
      state.channel = null
      state.connection = null
      scheduleReconnect()
    })

    channel.on('error', (err: Error) => {
      logger.error({ caller: 'connect', error: err.message }, 'RabbitMQ channel error')
    })

    // Channel close is handled by the connection close handler above; scheduling
    // reconnect here too would race with it and spuriously inflate the backoff
    // attempt counter.
    channel.on('close', () => {
      logger.warn({ caller: 'connect' }, 'RabbitMQ channel closed')
      state.channel = null
    })

    return true
  } catch (error) {
    state.isConnecting = false
    state.connection = null
    state.channel = null
    logger.error(
      { caller: 'connect', error: error instanceof Error ? error.message : error },
      'Failed to connect to RabbitMQ',
    )
    return false
  }
}

const scheduleReconnect = (): void => {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
  }

  const delay = calculateBackoff(state.reconnectAttempts)
  state.reconnectAttempts++

  logger.info(
    { caller: 'scheduleReconnect', attempt: state.reconnectAttempts, delayMs: Math.round(delay) },
    'Scheduling RabbitMQ reconnection',
  )

  state.reconnectTimer = setTimeout(async () => {
    const connected = await connect()
    if (!connected) {
      scheduleReconnect()
    }
  }, delay)
}

export const createRabbitMQClient = async (): Promise<RabbitMQClient> => {
  if (!env.RABBITMQ_URL) {
    throw new Error('RABBITMQ_URL is required')
  }

  const connected = await connect()
  if (!connected) {
    throw new Error('Failed to establish initial RabbitMQ connection')
  }

  return {
    getChannel(): AmqpChannel | null {
      return state.channel
    },

    isConnected(): boolean {
      return state.channel !== null && state.connection !== null
    },

    onConnect(cb: ConnectCallback): void {
      // Guard against duplicate registration — consumers register once at startup,
      // and connectCallbacks is module-level so repeated calls would otherwise
      // accumulate stale closures and re-run setup on every reconnect.
      if (!connectCallbacks.includes(cb)) {
        connectCallbacks.push(cb)
      }
      // If already connected, fire immediately
      if (state.channel) {
        cb(state.channel)
      }
    },

    async close(): Promise<void> {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer)
        state.reconnectTimer = null
      }

      try {
        if (state.channel) {
          await state.channel.close()
          state.channel = null
        }
        if (state.connection) {
          await state.connection.close()
          state.connection = null
        }
        logger.info({ caller: 'closeRabbitMQ' }, 'RabbitMQ connection closed gracefully')
      } catch (error) {
        logger.error(
          { caller: 'closeRabbitMQ', error: error instanceof Error ? error.message : error },
          'Error closing RabbitMQ connection',
        )
      }
    },
  }
}

let clientInstance: RabbitMQClient | null = null

export const getRabbitMQClient = async (): Promise<RabbitMQClient> => {
  if (!clientInstance) {
    clientInstance = await createRabbitMQClient()
  }
  return clientInstance
}

export const closeRabbitMQClient = async (): Promise<void> => {
  if (clientInstance) {
    await clientInstance.close()
    clientInstance = null
  }
}
