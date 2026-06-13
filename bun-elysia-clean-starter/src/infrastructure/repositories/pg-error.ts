// Postgres SQLSTATE codes surface on `.code` of Bun.SQL driver errors
// (same convention infrastructure/db/client.ts relies on).
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

const codeOf = (err: unknown): string | undefined =>
  (err as { code?: string })?.code;

export const isUniqueViolation = (err: unknown): boolean =>
  codeOf(err) === UNIQUE_VIOLATION;

export const isForeignKeyViolation = (err: unknown): boolean =>
  codeOf(err) === FOREIGN_KEY_VIOLATION;
