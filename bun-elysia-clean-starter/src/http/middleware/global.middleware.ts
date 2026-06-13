import { Elysia } from "elysia";
import { bodyLimitMiddleware } from "./body-limit.middleware";
import { errorMiddleware } from "./error.middleware";
import { loggingMiddleware } from "./logging.middleware";

/**
 * Cross-cutting middleware applied to the whole app: request context/logging
 * (correlation IDs) and the global error boundary. CORS, rate-limiting and
 * security headers are intentionally omitted (handled upstream by your gateway / reverse proxy /
 * the gateway). Add them here as `.use(...)` if that changes.
 *
 * Auth is NEVER mounted here — access level (public / requireAuth / requireCMS)
 * is declared per route group.
 *
 * `.as('global')` lifts the contained lifecycle hooks to every instance.
 */
export const globalMiddleware = new Elysia({ name: "global-middleware" })
  .use(loggingMiddleware)
  .use(errorMiddleware)
  // After errorMiddleware so its PAYLOAD_TOO_LARGE throw is always caught
  // and mapped to the standard 413 envelope.
  .use(bodyLimitMiddleware)
  .as("global");
