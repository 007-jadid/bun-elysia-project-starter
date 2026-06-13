import { defineConfig } from "drizzle-kit";

// Reads process.env directly (NOT src/config/env) so drizzle-kit CLI commands
// need only the WRITE_DB_* vars, not the full validated app env (Redis/RMQ/
// JWT...). Bun auto-loads .env files for `bunx --bun`, so `bun run db:*` works
// against .env.local out of the box.
//
// Migrations always run against the WRITE/primary database.
// This file lives in src/infrastructure/db/ alongside the client and tables —
// all DB concerns in one place; scripts pass --config to point drizzle-kit here.
const getDbUrl = (): string => {
  const {
    WRITE_DB_USER,
    WRITE_DB_PASS,
    WRITE_DB_HOST,
    WRITE_DB_PORT,
    WRITE_DB_NAME,
  } = process.env;
  return `postgresql://${WRITE_DB_USER}:${WRITE_DB_PASS}@${WRITE_DB_HOST}:${WRITE_DB_PORT}/${WRITE_DB_NAME}`;
};

export default defineConfig({
  schema: "./src/infrastructure/db/tables/index.ts",
  out: "./src/infrastructure/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: getDbUrl(),
  },
  verbose: true,
  strict: true,
});
