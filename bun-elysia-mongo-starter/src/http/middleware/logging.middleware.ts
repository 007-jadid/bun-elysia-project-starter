import { Elysia } from 'elysia'
import { generateId, logger, type RequestContext, setRequestContext } from '../../lib'

export const loggingMiddleware = new Elysia({ name: 'logging' })
  .derive({ as: 'global' }, ({ request, server }) => {
    const requestId = request.headers.get('x-request-id') || generateId()

    // Extract IP: try headers first (proxy/load balancer), then fall back to connection IP
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      server?.requestIP(request)?.address ||
      undefined

    const userAgent = request.headers.get('user-agent') || undefined
    const startTime = Date.now()

    // Set up request context for this request
    // This will be automatically injected into all logs via the logger mixin
    const requestContext: RequestContext = {
      requestId,
      ip,
      userAgent,
    }

    // Establish AsyncLocalStorage context for the entire request lifecycle
    setRequestContext(requestContext)

    // Store in context for access by handlers
    return {
      requestId,
      startTime,
    }
  })
  .onBeforeHandle({ as: 'global' }, ({ request, body }) => {
    const url = new URL(request.url)

    // All fields (requestId, ip, userAgent) are auto-injected by logger mixin
    logger.info(
      {
        caller: 'loggingMiddleware',
        method: request.method,
        path: url.pathname,
        query: url.search || undefined,
        ...(request.method !== 'GET' &&
          body != null &&
          typeof body === 'object' && { requestBody: body }),
      },
      'Request started',
    )
  })
  .onAfterHandle({ as: 'global' }, ({ request, startTime, set, requestId }) => {
    const latency = Date.now() - startTime
    const url = new URL(request.url)

    // Add request ID to response headers for distributed tracing
    set.headers['x-request-id'] = requestId

    // All context fields are auto-injected by logger mixin
    logger.info(
      {
        caller: 'loggingMiddleware',
        method: request.method,
        path: url.pathname,
        query: url.search || undefined,
        status: set.status || 200,
        latency,
      },
      'Request completed',
    )
  })
