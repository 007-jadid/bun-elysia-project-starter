import { type TSchema, t } from "elysia";

/**
 * Standard success response wrapper.
 * Format: { status: true, message: string, data: T }
 */
export const successResponse = <T extends TSchema>(data: T) =>
  t.Object({
    status: t.Literal(true),
    message: t.String(),
    data,
  });

/**
 * Standard success response with array data (non-paginated).
 * Format: { status: true, message: string, data: T[] }
 */
export const successArrayResponse = <T extends TSchema>(item: T) =>
  t.Object({
    status: t.Literal(true),
    message: t.String(),
    data: t.Array(item),
  });

/**
 * Standard paginated response wrapper.
 */
export const paginatedResponse = <T extends TSchema>(item: T) =>
  t.Object({
    status: t.Literal(true),
    message: t.String(),
    data: t.Object({
      items: t.Array(item),
      itemsPerPage: t.Number(),
      pageNumber: t.Number(),
      totalItems: t.Number(),
      totalPages: t.Number(),
    }),
  });

/**
 * Standard error response.
 * Format: { status: false, message: string, data: null }
 */
export const errorResponse = t.Object({
  status: t.Literal(false),
  message: t.String(),
  data: t.Null(),
});

/**
 * Failure response carrying a payload (e.g. health probe details on 503).
 * Format: { status: false, message: string, data: T }
 */
export const failureResponse = <T extends TSchema>(data: T) =>
  t.Object({
    status: t.Literal(false),
    message: t.String(),
    data,
  });

/** Helper to build a success response object. */
export const createSuccessResponse = <T>(data: T, message = "Success") => ({
  status: true as const,
  message,
  data,
});

/** Helper to build a failure response object with a payload. */
export const createFailureResponse = <T>(data: T, message: string) => ({
  status: false as const,
  message,
  data,
});

/** Helper to build a paginated response object. */
export const createPaginatedResponse = <T>(
  items: T[],
  pageNumber: number,
  itemsPerPage: number,
  totalItems: number,
  message = "Success",
) => ({
  status: true as const,
  message,
  data: {
    items,
    itemsPerPage,
    pageNumber,
    totalItems,
    totalPages: Math.ceil(totalItems / itemsPerPage),
  },
});
