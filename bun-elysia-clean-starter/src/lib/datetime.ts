/**
 * Single funnel for datetime handling. Store and transmit UTC ISO-8601
 * strings only; format for display in the client's timezone at the edge.
 *
 * Temporal note: Bun does not yet ship the Temporal API natively
 * (`typeof Temporal === "undefined"`), and the polyfill package would
 * contradict the Bun-native-first rule. Date/timezone-heavy domain logic is
 * exactly what Temporal improves — when Bun ships it, swap the
 * implementations HERE; call sites do not change.
 */

/** Current moment as a UTC ISO-8601 string (API timestamps). */
export const nowIso = (): string => new Date().toISOString();

/** Current moment in seconds since epoch (JWT-style timestamps). */
export const epochSeconds = (): number => Math.floor(Date.now() / 1000);
