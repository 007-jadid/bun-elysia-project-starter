import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context, automatically injected into every log line via the
 * logger mixin (see logger.ts). A common pattern for cross-service log
 * correlation.
 */
export interface RequestContext {
  /** Unique request identifier (from x-request-id header or generated). */
  requestId: string;
  /** Client IP (x-forwarded-for, x-real-ip, or direct connection). */
  ip?: string | undefined;
  /** User agent string from the request headers. */
  userAgent?: string | undefined;
  /** Authenticated user ID (set by auth middleware). */
  userId?: string | undefined;
  /** User type (Customer, CMS, ...) — set by auth middleware. */
  userType?: string | undefined;
}

/**
 * AsyncLocalStorage lets any code in the request's call stack read the context
 * without threading it through every function parameter.
 */
const requestContextStore = new AsyncLocalStorage<RequestContext>();

/** Current request context, or undefined outside a request. */
export const getRequestContext = (): RequestContext | undefined =>
  requestContextStore.getStore();

/** Run a function within a given request context (used by tests). */
export const runWithRequestContext = <T>(
  context: RequestContext,
  fn: () => T,
): T => requestContextStore.run(context, fn);

/**
 * Merge updates into the current context (e.g. userId after authentication).
 * No-op outside a request.
 */
export const updateRequestContext = (
  updates: Partial<RequestContext>,
): void => {
  const current = requestContextStore.getStore();
  if (current) {
    Object.assign(current, updates);
  }
};

/**
 * Establish the context for the current async execution (HTTP middleware).
 * `enterWith` is appropriate here because each request already runs in its own
 * async context.
 */
export const setRequestContext = (context: RequestContext): void => {
  requestContextStore.enterWith(context);
};
