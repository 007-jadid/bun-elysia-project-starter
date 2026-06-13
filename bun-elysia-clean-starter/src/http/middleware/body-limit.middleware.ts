import { Elysia } from "elysia";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";

/**
 * Two-tier request body limit, checked against the declared Content-Length
 * BEFORE the body is read (onRequest runs pre-routing, pre-parse):
 *
 *   - multipart/form-data (file uploads) → REQUEST_BODY_UPLOAD_MAX_SIZE (6MB)
 *   - everything else (JSON APIs)        → REQUEST_BODY_MAX_SIZE (1MB)
 *
 * Upload requests are detected by content type rather than a route allowlist
 * so future upload endpoints get the upload tier without touching this file.
 * Spoofing multipart on a JSON route buys nothing: Bun's server-wide
 * maxRequestBodySize (set to the upload tier in main.ts) already caps memory,
 * and the route's body schema rejects the payload anyway.
 *
 * Chunked requests without Content-Length skip this check and fall through
 * to Bun's runtime cap — acceptable, since real API clients always declare
 * Content-Length and memory exposure stays bounded either way.
 */
export const bodyLimitMiddleware = new Elysia({ name: "body-limit" })
  // The trailing .as("global") is REQUIRED for the same reason as
  // errorMiddleware's: globalMiddleware's own .as("global") does not lift a
  // child plugin's local hooks, and this check must cover every route.
  .onRequest(({ request }) => {
    const declared = Number(request.headers.get("content-length"));
    if (!Number.isFinite(declared) || declared <= 0) return;

    const isMultipart =
      request.headers
        .get("content-type")
        ?.toLowerCase()
        .includes("multipart/form-data") ?? false;
    const limit = isMultipart
      ? env.REQUEST_BODY_UPLOAD_MAX_SIZE
      : env.REQUEST_BODY_MAX_SIZE;

    if (declared > limit) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        `Request body of ${declared} bytes exceeds the ${limit} byte limit`,
      );
    }
  })
  .as("global");
