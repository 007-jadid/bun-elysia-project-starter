import { bearer } from '@elysiajs/bearer'
import { jwt } from '@elysiajs/jwt'
import { Elysia } from 'elysia'
import { env } from '../../config/env'
import { AppError, logger, updateRequestContext } from '../../lib'
import type { AuthUser, JWTPayload } from '../../types/user'
import { UserTypeEnum } from '../../types/user'

// Re-export AuthUser type for convenience
export type { AuthUser } from '../../types/user'

export const requireAuth = new Elysia({ name: 'require-auth' })
  .use(
    jwt({
      name: 'jwt',
      secret: env.JWT_SECRET,
      alg: 'HS256',
    }),
  )
  .use(bearer())
  .derive(async ({ jwt, bearer, request }) => {
    if (!bearer) {
      logger.warn({ caller: 'requireAuth', url: request.url }, 'No bearer token provided')
      throw new AppError('UNAUTHORIZED', 'Authentication required')
    }

    // Verify JWT token using Elysia JWT plugin
    const payload = (await jwt.verify(bearer)) as JWTPayload | false

    if (!payload) {
      logger.warn(
        {
          caller: 'requireAuth',
          url: request.url,
        },
        'JWT verification failed - invalid token or JWT_SECRET mismatch',
      )
      throw new AppError('UNAUTHORIZED', 'Invalid or expired token')
    }

    // Check expiration manually (jwt.verify should handle this, but let's be explicit)
    if (payload.exp && payload.exp < Date.now() / 1000) {
      logger.warn(
        { caller: 'requireAuth', url: request.url, exp: payload.exp },
        'Token has expired',
      )
      throw new AppError('UNAUTHORIZED', 'Token has expired')
    }

    // Extract user info
    const userId = payload.id
    if (!userId || Number.isNaN(userId)) {
      logger.warn({ caller: 'requireAuth', url: request.url, userId }, 'Invalid user ID in token')
      throw new AppError('UNAUTHORIZED', 'Invalid token format')
    }

    // Parse UserType as enum
    const userType = payload.UserType as UserTypeEnum
    if (!userType || !Object.values(UserTypeEnum).includes(userType)) {
      logger.warn(
        { caller: 'requireAuth', url: request.url, userType },
        'Invalid or missing UserType',
      )
      throw new AppError('UNAUTHORIZED', 'Invalid or missing UserType')
    }

    const user: AuthUser = {
      id: userId,
      UserType: userType,
      FirstName: payload.FirstName,
      LastName: payload.LastName,
      UserName: payload.UserName,
    }

    logger.info(
      { caller: 'requireAuth', userId: user.id, userType: user.UserType },
      'User authenticated successfully',
    )

    // Update request context with authenticated user info
    // This will make userId and userType available in ALL subsequent logs
    updateRequestContext({
      userId: user.id.toString(),
      userType: user.UserType,
    })

    return { user }
  })
  .as('scoped')
