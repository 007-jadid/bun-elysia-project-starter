import { Elysia } from 'elysia'
import { AppError, logger } from '../../lib'
import { UserTypeEnum } from '../../types/user'
import { requireAuth } from './auth.middleware'

/**
 * Middleware to ensure user is authenticated and has CMS user type
 * Must be used after requireAuth middleware
 */
export const requireCMS = new Elysia({ name: 'require-cms' })
  .use(requireAuth)
  .derive(({ user }) => {
    logger.info(
      { caller: 'requireCMS', userId: user?.id, userType: user?.UserType },
      'CMS derive executing',
    )

    // Guard check (should never happen due to requireAuth, but TypeScript doesn't know this)
    if (!user) {
      logger.error({ caller: 'requireCMS' }, 'User is undefined in requireCMS')
      throw new AppError('UNAUTHORIZED', 'Authentication required')
    }

    logger.debug(
      { caller: 'requireCMS', userId: user.id, userType: user.UserType },
      'CMS auth check',
    )

    if (user.UserType !== UserTypeEnum.CMS) {
      logger.warn(
        { caller: 'requireCMS', userId: user.id, userType: user.UserType },
        'Non-CMS user attempted to access CMS endpoint',
      )
      throw new AppError('FORBIDDEN', 'Access restricted to CMS users only')
    }

    return {}
  })
  .as('scoped')
