export type ErrorCode =
  // Generic errors
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "DUPLICATE_KEY"
  | "PAYLOAD_TOO_LARGE"
  | "TOO_MANY_ATTEMPTS"
  | "INTERNAL_ERROR";

/**
 * Application-level error carrying a stable, mappable `code`. Thrown from
 * handlers/services and translated to an HTTP response by `errorMiddleware`.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ============================================================================
// Error → HTTP Status Mapping
// ============================================================================

export const errorStatusMap: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  DUPLICATE_KEY: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_ATTEMPTS: 429,
  INTERNAL_ERROR: 500,
};

export const getHttpStatus = (code: ErrorCode): number =>
  errorStatusMap[code] || 500;
