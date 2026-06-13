import { Elysia } from "elysia";
import { getRequestContext, logger } from "../../lib";
import { AppError, errorStatusMap } from "../../lib/errors";

interface ElysiaValidationError {
  path: string;
  message: string;
  value?: unknown;
  type?: string;
}

/**
 * Format Elysia/TypeBox validation errors into a readable structure.
 * Reads `.all` (available in dev and prod) rather than `.message`, which is
 * sanitized in production.
 */
const formatTypeBoxError = (
  error: unknown,
): { message: string; errors?: Record<string, string[]> } => {
  const fieldErrors: Record<string, string[]> = {};

  if (error && typeof error === "object" && "all" in error) {
    const allErrors = (error as { all: ElysiaValidationError[] }).all;

    if (Array.isArray(allErrors) && allErrors.length > 0) {
      for (const err of allErrors) {
        // Drop array-index segments from the path ("/0/name" -> "name",
        // "/teams/2/flag" -> "teams.flag") so clients key errors by field
        // name regardless of where in an array body the bad item sits.
        const field =
          err.path
            ?.split("/")
            .filter((segment) => segment !== "" && !/^\d+$/.test(segment))
            .join(".") || "root";
        const message = err.message || "Invalid value";
        if (!fieldErrors[field]) fieldErrors[field] = [];
        // Same field failing in several array items would repeat the
        // identical message — keep each message once per field.
        if (!fieldErrors[field].includes(message)) {
          fieldErrors[field].push(message);
        }
      }
      return {
        message: "Validation failed for one or more fields",
        errors: fieldErrors,
      };
    }
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    message:
      errorMessage.length > 200
        ? "Validation failed. Please check your request format."
        : errorMessage || "Validation failed",
  };
};

/**
 * Global error boundary. Translates AppError / NOT_FOUND / VALIDATION / unknown
 * errors into the standard `{ status, message, data }` envelope and logs them.
 */
export const errorMiddleware = new Elysia({ name: "error-handler" })
  .error({ APP_ERROR: AppError })
  // `as: "global"` here is REQUIRED, not redundant with globalMiddleware's
  // `.as("global")`: a local onError stays encapsulated inside THIS instance —
  // the wrapper's cast does not lift a child plugin's local hooks. Verified by
  // test/error.test.ts (removing this turns every mapped error into a 500).
  .onError({ as: "global" }, ({ code, error, status, request, set }) => {
    // Seeded by loggingMiddleware; "unknown" only for failures before it runs.
    const requestId = getRequestContext()?.requestId ?? "unknown";
    set.headers["x-request-id"] = requestId;

    if (code === "APP_ERROR" || error instanceof AppError) {
      const appError = error as AppError;
      const httpStatus = errorStatusMap[appError.code] || 500;

      logger.warn(
        {
          requestId,
          errorCode: appError.code,
          message: appError.message,
          status: httpStatus,
        },
        "Application error",
      );

      return status(httpStatus, {
        status: false,
        message: appError.message,
        data: null,
      });
    }

    if (code === "NOT_FOUND") {
      logger.debug({ requestId, path: request.url }, "Route not found");
      return status(404, {
        status: false,
        message: "The requested resource was not found",
        data: null,
      });
    }

    if (code === "VALIDATION") {
      const formatted = formatTypeBoxError(error);
      logger.warn(
        { requestId, message: formatted.message, errors: formatted.errors },
        "TypeBox validation error",
      );
      return status(400, {
        status: false,
        message: formatted.message,
        data: formatted.errors || null,
      });
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        requestId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      },
      "Internal server error",
    );

    return status(500, {
      status: false,
      message: "An unexpected error occurred",
      data: null,
    });
  });
