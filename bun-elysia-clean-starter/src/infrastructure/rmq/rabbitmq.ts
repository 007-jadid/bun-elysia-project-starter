import amqp from "amqplib";
import { EXCHANGE_NAMES } from "../../config/constants";
import { env } from "../../config/env";
import { childLogger, type Disposable } from "../../lib";

const log = childLogger("rmq");

const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;
// Shows up in the RabbitMQ management UI — how DevOps tells connections apart.
const CONNECTION_NAME = env.SERVICE_NAME;

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;
export type AmqpChannel = Awaited<ReturnType<AmqpConnection["createChannel"]>>;

interface ConnectionState {
  connection: AmqpConnection | null;
  channel: AmqpChannel | null;
  isConnecting: boolean;
  /** Set during graceful close — blocks the close-event reconnect. (Some implementations
   * lacks this guard; its close() schedules a reconnect after shutdown.) */
  closing: boolean;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const state: ConnectionState = {
  connection: null,
  channel: null,
  isConnecting: false,
  closing: false,
  reconnectAttempts: 0,
  reconnectTimer: null,
};

const connectCallbacks: ConnectCallback[] = [];

export type ConnectCallback = (channel: AmqpChannel) => void;

export interface RabbitMQClient {
  getChannel(): AmqpChannel | null;
  isConnected(): boolean;
  onConnect(cb: ConnectCallback): void;
  close(): Promise<void>;
}

const calculateBackoff = (attempt: number): number => {
  const delay = Math.min(
    RECONNECT_BASE_DELAY * 2 ** attempt,
    RECONNECT_MAX_DELAY,
  );
  const jitter = Math.random() * 0.3 * delay;
  return delay + jitter;
};

// Runs on EVERY (re)connect, so topology survives broker restarts. Asserts the
// shared exchange only; assert/bind your queues here as you add consumers, e.g.:
//   await channel.assertQueue(QUEUE_NAMES.EXAMPLE, { durable: true });
//   await channel.bindQueue(
//     QUEUE_NAMES.EXAMPLE,
//     EXCHANGE_NAMES.APP,
//     ROUTING_KEYS.EXAMPLE,
//   );
const setupQueues = async (channel: AmqpChannel): Promise<void> => {
  await channel.assertExchange(EXCHANGE_NAMES.APP, "topic", {
    durable: true,
  });
};

const connect = async (): Promise<boolean> => {
  if (!env.RABBITMQ_URL) {
    return false;
  }

  if (state.isConnecting) {
    return false;
  }

  // Already connected — skip
  if (state.connection !== null && state.channel !== null) {
    return true;
  }

  state.isConnecting = true;

  // Hoisted so the catch can close a half-open connection: if amqp.connect()
  // succeeds but createChannel()/setupQueues() throws, the TCP connection (and
  // amqplib's heartbeat timers) would otherwise leak on every retry.
  let connection: AmqpConnection | null = null;

  try {
    // Non-null alias: the listener closures below need the narrowed type,
    // which the nullable hoisted binding can't carry into callbacks.
    const conn = await amqp.connect(env.RABBITMQ_URL, {
      clientProperties: { connection_name: CONNECTION_NAME },
    });
    connection = conn;
    const channel = await conn.createChannel();

    await setupQueues(channel);

    state.connection = conn;
    state.channel = channel;
    state.reconnectAttempts = 0;
    state.isConnecting = false;

    log.info("RabbitMQ connected and queues configured");

    for (const cb of connectCallbacks) {
      try {
        cb(channel);
      } catch (err) {
        log.error(
          { error: err instanceof Error ? err.message : err },
          "Error in onConnect callback",
        );
      }
    }

    conn.on("error", (err: Error) => {
      log.error({ error: err.message }, "RabbitMQ connection error");
    });

    conn.on("close", () => {
      log.warn("RabbitMQ connection closed");
      // Detach listeners from the dead connection/channel before dropping refs.
      // amqplib retains the objects in internal maps; without this, each
      // reconnect accumulates listener closures and their captured scope
      // (native memory drip on Bun).
      try {
        conn.removeAllListeners();
        channel.removeAllListeners();
      } catch {}
      state.channel = null;
      state.connection = null;
      scheduleReconnect();
    });

    channel.on("error", (err: Error) => {
      log.error({ error: err.message }, "RabbitMQ channel error");
    });

    // Channel close is handled by the connection close handler above;
    // scheduling reconnect here too would race with it and spuriously inflate
    // the backoff attempt counter.
    channel.on("close", () => {
      log.warn("RabbitMQ channel closed");
      state.channel = null;
    });

    return true;
  } catch (error) {
    // Close a half-open connection (connect succeeded, channel/setup failed) —
    // otherwise the socket leaks on every reconnect attempt. No close listener
    // is attached yet in this path, so this cannot trigger scheduleReconnect.
    if (connection) {
      await connection.close().catch(() => {});
    }
    state.isConnecting = false;
    state.connection = null;
    state.channel = null;
    log.error(
      { error: error instanceof Error ? error.message : error },
      "Failed to connect to RabbitMQ",
    );
    return false;
  }
};

const scheduleReconnect = (): void => {
  if (state.closing) return;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
  }

  const delay = calculateBackoff(state.reconnectAttempts);
  state.reconnectAttempts++;

  log.info(
    { attempt: state.reconnectAttempts, delayMs: Math.round(delay) },
    "Scheduling RabbitMQ reconnection",
  );

  state.reconnectTimer = setTimeout(async () => {
    const connected = await connect();
    if (!connected) {
      scheduleReconnect();
    }
  }, delay);
};

export const createRabbitMQClient = async (): Promise<RabbitMQClient> => {
  if (!env.RABBITMQ_URL) {
    throw new Error("RABBITMQ_URL is required");
  }

  const connected = await connect();
  if (!connected) {
    throw new Error("Failed to establish initial RabbitMQ connection");
  }

  return {
    getChannel(): AmqpChannel | null {
      return state.channel;
    },

    isConnected(): boolean {
      return state.channel !== null && state.connection !== null;
    },

    onConnect(cb: ConnectCallback): void {
      // Guard against duplicate registration — consumers register once at
      // startup, and connectCallbacks is module-level so repeated calls would
      // otherwise accumulate stale closures and re-run setup on every
      // reconnect.
      if (!connectCallbacks.includes(cb)) {
        connectCallbacks.push(cb);
      }
      // If already connected, fire immediately
      if (state.channel) {
        cb(state.channel);
      }
    },

    async close(): Promise<void> {
      state.closing = true;
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }

      try {
        if (state.channel) {
          await state.channel.close();
          state.channel = null;
        }
        if (state.connection) {
          await state.connection.close();
          state.connection = null;
        }
        log.info("RabbitMQ connection closed gracefully");
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : error },
          "Error closing RabbitMQ connection",
        );
      }
    },
  };
};

let clientInstance: RabbitMQClient | null = null;

export const getRabbitMQClient = async (): Promise<RabbitMQClient> => {
  if (!clientInstance) {
    clientInstance = await createRabbitMQClient();
  }
  return clientInstance;
};

export const closeRabbitMQClient = async (): Promise<void> => {
  if (clientInstance) {
    await clientInstance.close();
    clientInstance = null;
  }
};

/** Plugs RabbitMQ cleanup into the graceful-shutdown disposable chain. */
export const rmqDisposable: Disposable = {
  name: "rabbitmq",
  dispose: closeRabbitMQClient,
};
