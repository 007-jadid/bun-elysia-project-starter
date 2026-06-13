import { t } from 'elysia'
import { z } from 'zod'

// ============================================================================
// Shared Zod Schemas (used across route schema configs)
// ============================================================================

export const idParam = z.object({ id: z.string().describe('Resource ID') })

export const paginationQuery = t.Object(
  {
    // Pagination
    pageNumber: t.Optional(t.String({ description: 'Page number (default: 1)' })),
    itemsPerPage: t.Optional(t.String({ description: 'Items per page (default: 10, max: 100)' })),
    sortBy: t.Optional(t.String({ description: 'Sort field' })),
    sortOrder: t.Optional(t.String({ description: 'Sort order: asc | desc' })),
    search: t.Optional(t.String({ description: 'Search term' })),

    // Common filters
    isActive: t.Optional(t.String({ description: 'Filter by active status (true/false)' })),
    isVerified: t.Optional(t.String({ description: 'Filter by verified status (true/false)' })),
    status: t.Optional(t.String({ description: 'Filter by status' })),
    categoryId: t.Optional(t.String({ description: 'Filter by category ID' })),
    tagIds: t.Optional(t.String({ description: 'Filter by tag IDs (comma-separated)' })),
    createdWithin: t.Optional(t.String({ description: 'Time window in hours' })),
    fromDate: t.Optional(t.String({ description: 'Start date filter' })),
    toDate: t.Optional(t.String({ description: 'End date filter' })),
  },
  { additionalProperties: t.String() },
)

/**
 * Standard success response wrapper
 * Format: { status: true, message: string, data: T }
 */
export const successResponse = <T extends ReturnType<typeof t.Object>>(data: T) =>
  t.Object({
    status: t.Literal(true),
    message: t.String(),
    data,
  })

/**
 * Standard success response with array data (non-paginated)
 * Format: { status: true, message: string, data: T[] }
 */
export const successArrayResponse = <T extends ReturnType<typeof t.Object>>(item: T) =>
  t.Object({
    status: t.Literal(true),
    message: t.String(),
    data: t.Array(item),
  })

/**
 * Standard paginated response wrapper
 * Format: { status: true, message: string, data: { items: T[], itemsPerPage, pageNumber, totalItems, totalPages } }
 */
export const paginatedResponse = <T extends ReturnType<typeof t.Object>>(item: T) =>
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
  })

/**
 * Standard error response
 * Format: { status: false, message: string, data: null }
 */
export const errorResponse = t.Object({
  status: t.Literal(false),
  message: t.String(),
  data: t.Null(),
})

/**
 * Pre-built default success response schema for route configs.
 * Format: { status: true, message: string, data: T }
 */
export const defaultSuccessResponse = t.Object({
  status: t.Literal(true),
  message: t.String(),
  data: t.Any(),
})

/**
 * Pre-built paginated response schema for route configs.
 * Format: { status: true, message: string, data: { items: T[], itemsPerPage, pageNumber, totalItems, totalPages } }
 */
export const defaultPaginatedResponse = t.Object({
  status: t.Literal(true),
  message: t.String(),
  data: t.Object({
    items: t.Array(t.Any()),
    itemsPerPage: t.Number(),
    pageNumber: t.Number(),
    totalItems: t.Number(),
    totalPages: t.Number(),
  }),
})

/**
 * Pre-built response schemas including error responses for route configs.
 * Covers: 200 (success), 400 (validation), 401 (unauthorized), 404 (not found), 500 (server error)
 */
export const defaultResponseSchemas = {
  200: defaultSuccessResponse,
  400: errorResponse,
  401: errorResponse,
  404: errorResponse,
  500: errorResponse,
} as const

/**
 * Pre-built paginated response schemas including error responses for route configs.
 * Covers: 200 (paginated), 400 (validation), 401 (unauthorized), 404 (not found), 500 (server error)
 */
export const paginatedResponseSchemas = {
  200: defaultPaginatedResponse,
  400: errorResponse,
  401: errorResponse,
  404: errorResponse,
  500: errorResponse,
} as const

/**
 * Helper type for pagination data
 */
export interface PaginationData<T> {
  items: T[]
  itemsPerPage: number
  pageNumber: number
  totalItems: number
  totalPages: number
}

/**
 * Helper to create a success response object
 */
export const createSuccessResponse = <T>(data: T, message = 'Success') => ({
  status: true as const,
  message,
  data,
})

/**
 * Helper to create a paginated response object
 */
export const createPaginatedResponse = <T>(
  items: T[],
  pageNumber: number,
  itemsPerPage: number,
  totalItems: number,
  message = 'Success',
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
})

// ============================================================================
// Typed Response Schema Builders (for OpenAPI documentation with actual data shapes)
// ============================================================================

/**
 * Creates typed success response schemas for OpenAPI documentation.
 * Uses t.Any() wrapper to preserve JSON Schema for docs while avoiding
 * TypeScript conflicts between domain types (Date) and schema types (string).
 */
export const typedResponse = (dataSchema: any) => ({
  200: t.Object({
    status: t.Literal(true),
    message: t.String(),
    data: t.Any(dataSchema),
  }),
  400: errorResponse,
  401: errorResponse,
  404: errorResponse,
  500: errorResponse,
})

/**
 * Creates typed array response schemas for OpenAPI documentation.
 * For endpoints that return arrays as data (e.g. list endpoints).
 */
export const typedArrayResponse = (itemSchema: any) => ({
  200: t.Object({
    status: t.Literal(true),
    message: t.String(),
    data: t.Any(t.Array(itemSchema)),
  }),
  400: errorResponse,
  401: errorResponse,
  404: errorResponse,
  500: errorResponse,
})

/**
 * Creates typed paginated response schemas for OpenAPI documentation.
 * Shows items array with the actual item shape, plus pagination metadata.
 */
export const typedPaginatedResponse = (itemSchema: any) => ({
  200: t.Object({
    status: t.Literal(true),
    message: t.String(),
    data: t.Any(
      t.Object({
        items: t.Array(itemSchema),
        itemsPerPage: t.Number(),
        pageNumber: t.Number(),
        totalItems: t.Number(),
        totalPages: t.Number(),
      }),
    ),
  }),
  400: errorResponse,
  401: errorResponse,
  404: errorResponse,
  500: errorResponse,
})
