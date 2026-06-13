import { Elysia } from 'elysia'
import { env } from '../../config/env'
import { AppError } from '../../lib'

/**
 * Formats bytes into human-readable string
 */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

/**
 * Checks content-length against a maximum size limit
 * @returns Error message if limit exceeded, null otherwise
 */
const checkBodySize = (request: Request, maxSize: number): string | null => {
  const contentLength = request.headers.get('content-length')

  if (contentLength) {
    const size = Number.parseInt(contentLength, 10)
    if (size > maxSize) {
      return `Request body too large. Maximum allowed: ${formatBytes(maxSize)}, received: ${formatBytes(size)}`
    }
  }

  return null
}

/**
 * Global body limit middleware using REQUEST_BODY_MAX_SIZE env var
 */
export const bodyLimitMiddleware = new Elysia({ name: 'body-limit-middleware' }).onParse(
  { as: 'global' },
  async ({ request }) => {
    const error = checkBodySize(request, env.REQUEST_BODY_MAX_SIZE)
    if (error) {
      throw new AppError('PAYLOAD_TOO_LARGE', error)
    }
  },
)

/**
 * Creates a per-route body limit middleware with custom size
 *
 * @param maxSizeBytes - Maximum body size in bytes
 * @returns Elysia plugin to apply on specific routes
 *
 * @example
 * ```ts
 * // Allow 5MB for file upload endpoint
 * app.post('/upload', handler, {
 *   beforeHandle: [createBodyLimit(5 * 1024 * 1024)]
 * })
 *
 * // Or use as a plugin for a group of routes
 * app.group('/uploads', (app) =>
 *   app
 *     .use(createBodyLimit(10 * 1024 * 1024)) // 10MB for all upload routes
 *     .post('/image', imageHandler)
 *     .post('/document', documentHandler)
 * )
 * ```
 */
export const createBodyLimit = (maxSizeBytes: number) => {
  return new Elysia({ name: `body-limit-${maxSizeBytes}` }).onParse(
    { as: 'scoped' },
    async ({ request }) => {
      const error = checkBodySize(request, maxSizeBytes)
      if (error) {
        throw new AppError('PAYLOAD_TOO_LARGE', error)
      }
    },
  )
}

/**
 * Predefined body limits for common use cases
 */
export const BodyLimits = {
  /** 100 KB - Small JSON payloads */
  SMALL: 102400,
  /** 1 MB - Default, standard JSON APIs */
  MEDIUM: 1048576,
  /** 5 MB - Larger payloads, small files */
  LARGE: 5242880,
  /** 10 MB - File uploads */
  XLARGE: 10485760,
  /** 50 MB - Large file uploads */
  XXLARGE: 52428800,
} as const
