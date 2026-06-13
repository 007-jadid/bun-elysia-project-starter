import { bearer } from "@elysiajs/bearer";
import { jwt } from "@elysiajs/jwt";
import { Elysia } from "elysia";
import { env } from "../../config/env";
import { logger, updateRequestContext } from "../../lib";
import { AppError } from "../../lib/errors";
import type { AuthUser, JWTPayload } from "../../types/user";
import { UserTypeEnum } from "../../types/user";

export type { AuthUser } from "../../types/user";

/**
 * Scoped auth plugin. This service VERIFIES tokens issued elsewhere — it does
 * not sign them. Mount via `.use(requireAuth)` on a route group; handlers then
 * receive a typed `user` in context. Throws AppError('UNAUTHORIZED') on failure,
 * which `errorMiddleware` maps to a 401.
 *
 * `.as('scoped')` exports the `derive` to the parent group (the routes that
 * use it) without leaking to the whole app.
 */
export const requireAuth = new Elysia({ name: "auth" })
  .use(
    jwt({
      name: "jwt",
      secret: env.JWT_SECRET,
      alg: "HS256",
    }),
  )
  .use(bearer())
  .derive(async ({ jwt, bearer, request }) => {
    if (!bearer) {
      logger.warn(
        { caller: "requireAuth", url: request.url },
        "No bearer token provided",
      );
      throw new AppError("UNAUTHORIZED", "Authentication required");
    }

    const payload = (await jwt.verify(bearer)) as JWTPayload | false;

    if (!payload) {
      logger.warn(
        { caller: "requireAuth", url: request.url },
        "JWT verification failed - invalid token or JWT_SECRET mismatch",
      );
      throw new AppError("UNAUTHORIZED", "Invalid or expired token");
    }

    if (payload.exp && payload.exp < Date.now() / 1000) {
      logger.warn(
        { caller: "requireAuth", url: request.url, exp: payload.exp },
        "Token has expired",
      );
      throw new AppError("UNAUTHORIZED", "Token has expired");
    }

    const userId = payload.id;
    if (!userId || Number.isNaN(userId)) {
      logger.warn(
        { caller: "requireAuth", url: request.url, userId },
        "Invalid user ID in token",
      );
      throw new AppError("UNAUTHORIZED", "Invalid token format");
    }

    // Validate UserType against the known enum.
    const userType = payload.UserType as UserTypeEnum;
    if (!userType || !Object.values(UserTypeEnum).includes(userType)) {
      logger.warn(
        { caller: "requireAuth", url: request.url, userType },
        "Invalid or missing UserType",
      );
      throw new AppError("UNAUTHORIZED", "Invalid or missing UserType");
    }

    const user: AuthUser = {
      id: userId,
      UserType: userType,
      FirstName: payload.FirstName,
      LastName: payload.LastName,
      UserName: payload.UserName,
    };

    logger.debug(
      { caller: "requireAuth", userId: user.id, userType: user.UserType },
      "User authenticated successfully",
    );

    // Make userId/userType appear in every subsequent log line of this request.
    updateRequestContext({
      userId: user.id.toString(),
      userType: user.UserType,
    });

    return { user };
  })
  .as("scoped");
