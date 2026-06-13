import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Request context that gets automatically injected into all logs
 */
export interface RequestContext {
  /** Unique request identifier (from x-request-id header or generated) */
  requestId: string
  /** Client IP address (from x-forwarded-for, x-real-ip, or direct connection) */
  ip?: string
  /** User agent string from the request headers */
  userAgent?: string
  /** Authenticated user ID (set by auth middleware) */
  userId?: string
  /** User type (Customer, Admin, CMS, ...) - set by auth middleware */
  userType?: string
}

/**
 * AsyncLocalStorage instance for request context.
 * This allows us to access request context anywhere in the call stack
 * without passing it through every function parameter.
 */
const requestContextStore = new AsyncLocalStorage<RequestContext>()

/**
 * Get the current request context from AsyncLocalStorage.
 * Returns undefined if called outside of a request context.
 */
export const getRequestContext = (): RequestContext | undefined => {
  return requestContextStore.getStore()
}

/**
 * Run a function within a request context.
 * All logs and code executed within this function will have access to the context.
 */
export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T => {
  return requestContextStore.run(context, fn)
}

/**
 * Update the current request context (useful for adding userId after authentication).
 * Merges the updates with existing context.
 */
export const updateRequestContext = (updates: Partial<RequestContext>): void => {
  const current = requestContextStore.getStore()
  if (current) {
    Object.assign(current, updates)
  }
}

/**
 * Set the request context for the current async execution context.
 * This establishes the context for the entire HTTP request lifecycle.
 *
 * Note: Uses enterWith() which is simpler than run() for HTTP middleware,
 * where each request already runs in its own async context.
 */
export const setRequestContext = (context: RequestContext): void => {
  requestContextStore.enterWith(context)
}
