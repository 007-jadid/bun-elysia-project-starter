import { Elysia } from 'elysia'
import { ZodError } from 'zod'
import { AppError, type ErrorCode, logger } from '../../lib'

// ============================================================================
// Types
// ============================================================================

interface ElysiaValidationError {
  path: string
  message: string
  value?: unknown
  type?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Human-readable error messages for fields that use regex pattern validation.
 * Prevents raw regex patterns from leaking into API responses.
 */
const patternErrorMessages: Record<string, string> = {
  scheduledAt:
    'scheduledAt must be ISO 8601 with timezone (e.g. 2026-04-16T13:00:00Z or 2026-04-16T13:00:00+06:00)',
}

/**
 * Format Elysia/TypeBox validation errors into a readable structure.
 * Uses error.all property which is available in both dev and production,
 * unlike error.message which is sanitized in production.
 */
const formatTypeBoxError = (
  error: unknown,
): { message: string; errors?: Record<string, string[]> } => {
  const fieldErrors: Record<string, string[]> = {}

  // Access .all property directly (available in both dev and prod)
  if (error && typeof error === 'object' && 'all' in error) {
    const allErrors = (error as { all: ElysiaValidationError[] }).all

    if (Array.isArray(allErrors) && allErrors.length > 0) {
      for (const err of allErrors) {
        // Clean up path: remove leading slash and convert to dot notation
        const field = err.path?.replace(/^\//, '').replace(/\//g, '.') || 'root'
        // Replace raw regex pattern messages with human-readable errors
        let message = err.message || 'Invalid value'
        if (/Expected string to match '/.test(message)) {
          message = patternErrorMessages[field] ?? `Invalid ${field} format`
        }

        if (!fieldErrors[field]) {
          fieldErrors[field] = []
        }
        fieldErrors[field].push(message)
      }

      return {
        message: 'Validation failed for one or more fields',
        errors: fieldErrors,
      }
    }
  }

  // Fallback: try to get message from error
  const errorMessage = error instanceof Error ? error.message : String(error)

  return {
    message:
      errorMessage.length > 200
        ? 'Validation failed. Please check your request format.'
        : errorMessage || 'Validation failed',
  }
}

/**
 * Format Zod validation errors into a readable structure.
 */
const formatZodError = (error: ZodError): { message: string; errors: Record<string, string[]> } => {
  const fieldErrors: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : 'root'
    if (!fieldErrors[field]) {
      fieldErrors[field] = []
    }
    fieldErrors[field].push(issue.message)
  }

  return {
    message: 'Validation failed for one or more fields',
    errors: fieldErrors,
  }
}

// ============================================================================
// Error Status Mapping
// ============================================================================

const errorStatusMap: Record<ErrorCode, number> = {
  // Generic errors
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
}

export const errorMiddleware = new Elysia({ name: 'error-handler' })
  .error({ APP_ERROR: AppError })
  .onError({ as: 'global' }, ({ code, error, status, request, set, body }) => {
    const requestId = request.headers.get('x-request-id') || 'unknown'

    // Add request ID to error response headers for distributed tracing
    set.headers['x-request-id'] = requestId

    // Handle custom AppError (check both code and instanceof for cross-scope errors)
    if (code === 'APP_ERROR' || error instanceof AppError) {
      const appError = error as AppError
      const httpStatus = errorStatusMap[appError.code] || 500
      const errorOrigin = httpStatus >= 500 ? 'server' : 'client'
      const logData = {
        requestId,
        errorCode: appError.code,
        message: appError.message,
        status: httpStatus,
        errorOrigin,
        requestBody: body,
      }

      if (errorOrigin === 'server') {
        logger.error(logData, 'Application error')
      } else {
        logger.warn(logData, 'Application error')
      }

      return status(httpStatus, {
        status: false,
        message: appError.message,
        data: null,
      })
    }

    // Handle Elysia's built-in NOT_FOUND error
    if (code === 'NOT_FOUND') {
      logger.debug({ requestId, path: request.url }, 'Route not found')

      return status(404, {
        status: false,
        message: 'The requested resource was not found',
        data: null,
      })
    }

    // Handle Elysia/TypeBox validation errors (route level) — always client error
    if (code === 'VALIDATION') {
      const formatted = formatTypeBoxError(error)

      logger.warn(
        {
          requestId,
          errorOrigin: 'client',
          message: formatted.message,
          errors: formatted.errors,
          requestBody: body,
        },
        'TypeBox validation error',
      )

      return status(400, {
        status: false,
        message: formatted.message,
        data: formatted.errors || null,
      })
    }

    // Handle Zod validation errors (service/use case level) — always client error
    if (error instanceof ZodError) {
      const formatted = formatZodError(error)

      logger.warn(
        {
          requestId,
          errorOrigin: 'client',
          message: formatted.message,
          errors: formatted.errors,
          requestBody: body,
        },
        'Zod validation error',
      )

      return status(400, {
        status: false,
        message: formatted.message,
        data: formatted.errors,
      })
    }

    // Handle Mongoose ValidationError — server error (missing/null data in DB, not bad client input)
    if (error instanceof Error && error.name === 'ValidationError' && 'errors' in error) {
      logger.error(
        {
          requestId,
          errorOrigin: 'server',
          reason:
            'Mongoose schema validation failed due to missing server-side data (not client input)',
          error: {
            name: error.name,
            message: error.message,
            errors: (error as unknown as Record<string, unknown>).errors,
          },
          requestBody: body,
        },
        'Mongoose validation error',
      )

      return status(500, {
        status: false,
        message: 'An unexpected error occurred',
        data: null,
      })
    }

    // Unknown errors — always server error
    const errorMessage = error instanceof Error ? error.message : String(error)

    logger.error(
      {
        requestId,
        errorOrigin: 'server',
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        requestBody: body,
      },
      'Internal server error',
    )

    return status(500, {
      status: false,
      message: 'An unexpected error occurred',
      data: null,
    })
  })
