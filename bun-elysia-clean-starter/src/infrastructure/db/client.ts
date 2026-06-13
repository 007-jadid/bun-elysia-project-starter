import { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import { env, isProd } from "../../config/env";
import { childLogger, type Disposable } from "../../lib";
import * as schema from "./tables";

const log = childLogger("db");

type Schema = typeof schema;
export type Database = BunSQLDatabase<Schema>;

/**
 * Two physically separate connection pools backed by Bun's native SQL driver:
 *   - write -> primary (INSERT/UPDATE/DELETE, transactions)
 *   - read  -> replica (SELECT) — may point at a read replica host
 * They are independent `Bun.SQL` instances with their own host/creds/sizing,
 * so read load never starves write connections and vice-versa.
 */
export type DbClients = {
  /** Primary — use for all writes and transactions. */
  writeDb: Database;
  /** Replica — use for read-only queries. */
  readDb: Database;
};

/**
 * `application_name` is not a first-class `Bun.SQL` option, so we carry it as a
 * connection-string query parameter. host/port/db/creds stay as discrete
 * options below — Bun merges the URL with the option object.
 */
const buildAppNameUrl = (kind: "write" | "read"): string =>
  `postgres://?application_name=${encodeURIComponent(`${env.SERVICE_NAME}-${kind}`)}`;

const createClient = (kind: "write" | "read"): SQL => {
  const isWrite = kind === "write";
  return new SQL({
    url: buildAppNameUrl(kind),
    hostname: isWrite ? env.WRITE_DB_HOST : env.READ_DB_HOST,
    port: isWrite ? env.WRITE_DB_PORT : env.READ_DB_PORT,
    database: isWrite ? env.WRITE_DB_NAME : env.READ_DB_NAME,
    username: isWrite ? env.WRITE_DB_USER : env.READ_DB_USER,
    password: isWrite ? env.WRITE_DB_PASS : env.READ_DB_PASS,
    max: isWrite ? env.WRITE_DB_POOL_MAX : env.READ_DB_POOL_MAX,
    // Bun.SQL timeouts are in seconds; env values are already in seconds.
    idleTimeout: isWrite ? env.WRITE_DB_IDLE_TIMEOUT : env.READ_DB_IDLE_TIMEOUT,
    // Recycle connections after 30 min so the pool follows DNS/replica failover
    // and doesn't pin a single backend forever (0 would mean never recycle).
    maxLifetime: 1800,
    // Time out a connection attempt rather than hanging forever on startup.
    // More forgiving in dev (cold Docker), tighter in prod (fail fast).
    connectionTimeout: isProd ? 10 : 30,
    tls: (isWrite ? env.WRITE_DB_ENABLE_SSL_MODE : env.READ_DB_ENABLE_SSL_MODE)
      ? { rejectUnauthorized: false }
      : false,
    onclose: (err) => {
      // `onclose` fires for EVERY connection close, including the intentional
      // ones the pool does on purpose: idle connections recycled after
      // `idleTimeout`, and connections aged out by `maxLifetime`. Those are
      // healthy lifecycle events, not faults — log them at trace so they stay
      // out of the way even at debug level (a whole pool recycles in one burst).
      // Only an unexpected drop (server kill, network reset, auth revoked) is
      // an error. `err` is null on a clean shutdown close.
      if (!err) return;
      const code = (err as { code?: string }).code;
      if (
        code === "ERR_POSTGRES_IDLE_TIMEOUT" ||
        code === "ERR_POSTGRES_LIFETIME_TIMEOUT"
      ) {
        log.trace({ pool: kind, code }, "Pooled connection recycled");
        return;
      }
      log.error({ pool: kind, err }, "Database connection closed unexpectedly");
    },
  });
};

/**
 * Map common Postgres / driver error codes to a one-line, actionable hint so a
 * developer sees *what to fix* instead of a raw driver stack trace.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const pgErrorHint = (code: string | undefined): string => {
  switch (code) {
    case "28P01":
      return "Password authentication failed — check DB_USER / DB_PASS in your .env.";
    case "28000":
      return "Authorization failed — user may lack login rights or pg_hba.conf rejects this host.";
    case "3D000":
      return "Database does not exist — check DB_NAME (create it or fix the value).";
    case "ECONNREFUSED":
      return "Connection refused — Postgres isn't running or DB_HOST/DB_PORT is wrong. Try `bun run deps:up`.";
    case "ETIMEDOUT":
      return "Connection timed out — wrong host/port, or a firewall is blocking it.";
    case "ENOTFOUND":
      return "Host not found — DB_HOST does not resolve.";
    default:
      return "See the error message above for details.";
  }
};

const ping = async (sql: SQL, kind: "write" | "read"): Promise<void> => {
  const prefix = kind === "write" ? "WRITE_DB" : "READ_DB";
  try {
    await sql`SELECT 1`;
    log.info({ pool: kind }, "Database pool connected");
  } catch (err) {
    // Bun.SQL surfaces the Postgres SQLSTATE on `.code`; ECONNREFUSED etc. for
    // socket errors.
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);

    log.error(
      {
        pool: kind,
        code,
        host: kind === "write" ? env.WRITE_DB_HOST : env.READ_DB_HOST,
        port: kind === "write" ? env.WRITE_DB_PORT : env.READ_DB_PORT,
        database: kind === "write" ? env.WRITE_DB_NAME : env.READ_DB_NAME,
        user: kind === "write" ? env.WRITE_DB_USER : env.READ_DB_USER,
        // Never log the password itself.
        hint: pgErrorHint(code),
      },
      `Cannot connect to the ${kind} database (${prefix}_*): ${message}`,
    );

    // Throw a concise, already-explained error. The startup path logs this and
    // exits — no raw driver/TCP stack trace reaches the developer.
    throw new Error(
      `${kind} database connection failed [${code ?? "unknown"}]: ${pgErrorHint(code)}`,
    );
  }
};

/**
 * Create both Bun.SQL clients + Drizzle instances and verify connectivity
 * (fail-fast). Returns the clients plus a Disposable that closes both on
 * shutdown.
 *
 * Throws if either client can't connect — the caller should exit on startup.
 */
export const connectDb = async (): Promise<DbClients & Disposable> => {
  const writeSql = createClient("write");
  const readSql = createClient("read");

  // Verify both before serving traffic.
  await Promise.all([ping(writeSql, "write"), ping(readSql, "read")]);

  const writeDb = drizzle({ client: writeSql, schema });
  const readDb = drizzle({ client: readSql, schema });

  return {
    writeDb,
    readDb,
    name: "database",
    dispose: async () => {
      // `.close()` drains in-flight queries before closing the pool (canonical
      // Bun.SQL shutdown; `.end()` is an alias).
      await Promise.all([writeSql.close(), readSql.close()]);
    },
  };
};
