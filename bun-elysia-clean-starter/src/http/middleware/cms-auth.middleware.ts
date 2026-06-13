import { Elysia } from "elysia";
import { logger } from "../../lib";
import { AppError } from "../../lib/errors";
import { UserTypeEnum } from "../../types/user";
import { requireAuth } from "./auth.middleware";

/**
 * Auth guard for CMS-only (admin) route groups — composes `requireAuth` and
 * additionally requires `UserType === CMS`.
 *
 * Usage: `.use(requireCMS)` inside an admin feature group. Never mount
 * globally — access level is declared per route group.
 */
export const requireCMS = new Elysia({ name: "require-cms" })
  .use(requireAuth)
  .derive(({ user }) => {
    // requireAuth guarantees `user`, but TypeScript can't know that here.
    if (!user) {
      logger.error({ caller: "requireCMS" }, "User is undefined in requireCMS");
      throw new AppError("UNAUTHORIZED", "Authentication required");
    }

    if (user.UserType !== UserTypeEnum.CMS) {
      logger.warn(
        { caller: "requireCMS", userId: user.id, userType: user.UserType },
        "Non-CMS user attempted to access CMS endpoint",
      );
      throw new AppError("FORBIDDEN", "Access restricted to CMS users only");
    }

    return {};
  })
  .as("scoped");
