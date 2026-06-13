import { t } from "elysia";

/**
 * Elysia Reference Models — registered once via `.model(allModels)` and then
 * referenced by name in route schemas. Referencing by name (rather than
 * inlining `t.Object`) gives named components in the OpenAPI spec and faster
 * TypeScript inference. Add feature models here as routes are built.
 *
 * @see https://elysiajs.com — Reference Model
 */

export const commonModels = {
  Error: t.Object(
    {
      status: t.Literal(false),
      message: t.String(),
      data: t.Null(),
    },
    { description: "Standard error response" },
  ),
};

export const allModels = {
  ...commonModels,
};
