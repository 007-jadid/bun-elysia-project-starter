import { Elysia } from 'elysia'
import { bodyLimitMiddleware } from './body-limit.middleware'
import { corsMiddleware } from './cors.middleware'
import { errorMiddleware } from './error.middleware'
import { loggingMiddleware } from './logging.middleware'
import { securityHeadersMiddleware } from './security-headers.middleware'

export const globalMiddleware = new Elysia({ name: 'global-middleware' })
  .use(corsMiddleware)
  .use(bodyLimitMiddleware)
  .use(loggingMiddleware)
  .use(securityHeadersMiddleware)
  .use(errorMiddleware)
  .as('global')
