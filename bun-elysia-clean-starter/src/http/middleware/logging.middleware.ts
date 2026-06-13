import { Elysia } from "elysia";
import { logger } from "../../lib/logger";
import {
  type RequestContext,
  setRequestContext,
} from "../../lib/request-context";

/**
 * Request logging + correlation middleware.
 *
 * For every request it:
 *   1. takes the incoming `x-request-id` (from a gateway / proxy) or generates one
 *      with the Bun-native crypto.randomUUID (no extra package
 *      deliberately not borrowed),
 *   2. seeds the AsyncLocalStorage request context, which the logger mixin
 *      injects into every log line of this request,
 *   3. echoes `x-request-id` on the response for distributed tracing,
 *   4. logs request start/completion with latency.
 */
export const loggingMiddleware = new Elysia({ name: "logging" })
  .derive({ as: "global" }, ({ request, server }) => {
    const requestId =
      request.headers.get("x-request-id") || crypto.randomUUID();

    // Prefer proxy headers (x-forwarded-for / x-real-ip), fall back to socket IP.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      server?.requestIP(request)?.address ||
      undefined;

    const userAgent = request.headers.get("user-agent") || undefined;
    const startTime = Date.now();

    const requestContext: RequestContext = {
      requestId,
      ip,
      userAgent,
    };

    // Establish AsyncLocalStorage context for the whole request lifecycle.
    setRequestContext(requestContext);

    return { requestId, startTime };
  })
  .onBeforeHandle({ as: "global" }, ({ request, body }) => {
    const url = new URL(request.url);

    // requestId/ip/userAgent are auto-injected by the logger mixin.
    logger.info(
      {
        caller: "loggingMiddleware",
        method: request.method,
        path: url.pathname,
        query: url.search || undefined,
        ...(request.method !== "GET" &&
          body != null &&
          typeof body === "object" && {
            bodyFields: Object.keys(body as object),
          }),
      },
      "Request started",
    );
  })
  .onAfterHandle({ as: "global" }, ({ request, startTime, set, requestId }) => {
    const latency = Date.now() - startTime;
    const url = new URL(request.url);

    // Echo the request ID so callers/other services can correlate.
    set.headers["x-request-id"] = requestId;

    logger.info(
      {
        caller: "loggingMiddleware",
        method: request.method,
        path: url.pathname,
        query: url.search || undefined,
        status: set.status || 200,
        latency,
      },
      "Request completed",
    );
  })
  // onAfterHandle does NOT run when a handler/derive throws, so errored
  // requests would otherwise get a start line but no completion/latency line.
  // Returning nothing lets the error fall through to errorMiddleware, which
  // still owns the response envelope and detailed error logging.
  .onError({ as: "global" }, (ctx) => {
    const { request, code } = ctx;
    // Undefined when the error fired before the derive ran (e.g. NOT_FOUND).
    const startTime = (ctx as { startTime?: number }).startTime;
    const url = new URL(request.url);

    logger.info(
      {
        caller: "loggingMiddleware",
        method: request.method,
        path: url.pathname,
        query: url.search || undefined,
        errorCode: code,
        ...(startTime !== undefined && { latency: Date.now() - startTime }),
      },
      "Request failed",
    );
  });
