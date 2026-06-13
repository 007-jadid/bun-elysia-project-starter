import { Elysia } from 'elysia'

export const securityHeadersMiddleware = new Elysia({ name: 'security-headers' }).onAfterHandle(
  { as: 'global' },
  ({ set }) => {
    set.headers['x-content-type-options'] = 'nosniff'
    set.headers['x-frame-options'] = 'DENY'
    set.headers['cache-control'] = 'no-store'
    set.headers['x-xss-protection'] = '0'
  },
)
