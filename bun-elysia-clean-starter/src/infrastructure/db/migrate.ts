import { migrate } from "drizzle-orm/bun-sql/migrator";
import { isProd } from "../../config/env";
import { childLogger } from "../../lib";
import type { Database } from "./client";

const log = childLogger("db");

// Resolved against process.cwd() (/app in the container) — the Dockerfile
// copies the .sql files + meta/_journal.json to this exact path because they
// are read from disk at runtime, not bundled into dist/server.js.
const MIGRATIONS_FOLDER = "./src/infrastructure/db/migrations";

/**
 * Apply pending migrations on startup, production only: the prod image is
 * distroless (no shell), so `bun run db:migrate` cannot be exec'd in the
 * container. Drizzle applies
 * all pending .sql files in a single transaction against the WRITE pool and
 * tracks state in drizzle.__drizzle_migrations.
 *
 * In dev this is a no-op — run `bun run db:migrate` manually.
 *
 * Throws on failure — the caller's startup guard logs and exits, so the
 * service never serves traffic against a half-migrated schema.
 */
export const applyMigrations = async (writeDb: Database): Promise<void> => {
  if (!isProd) {
    log.debug("Skipping startup migrations (dev) — run `bun run db:migrate`");
    return;
  }
  await migrate(writeDb, { migrationsFolder: MIGRATIONS_FOLDER });
  log.info("Database migrations applied");
};
