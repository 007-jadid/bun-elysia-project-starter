/**
 * Pagination query builder for Mongoose with mongoose-paginate-v2
 */

export interface PaginateOptions {
  page: number
  limit: number
  sort: Record<string, 1 | -1>
  select?: string
  populate?: Array<{ path: string; select?: string }> | string
}

export interface PaginatedResult<T> {
  docs: T[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  pagingCounter: number
  hasPrevPage: boolean
  hasNextPage: boolean
  prevPage: number | null
  nextPage: number | null
}

export interface PaginationQueryParams {
  pageNumber?: string
  itemsPerPage?: string
  sortBy?: string
  sortOrder?: string
  search?: string
  [key: string]: unknown
}

export interface PaginationOptions {
  queries?: Record<string, unknown>[]
  searchables?: string[]
  sortables?: string[]
  filterables?: string[]
  getFilterQueries?: (queryParams: PaginationQueryParams) => Promise<Record<string, unknown>[]>
}

export interface PreparedQuery {
  query: Record<string, unknown>
  page: number
  limit: number
  sort: Record<string, 1 | -1>
}

/**
 * Coerce string query param values to their appropriate JS types.
 * URL query params are always strings — this converts "true"/"false" to booleans
 * and numeric strings to numbers so MongoDB queries match correctly.
 */
export function coerceQueryValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value === 'true') return true
  if (value === 'false') return false
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value)
  return value
}

export const preparePaginationQuery = async (
  queryParams: PaginationQueryParams,
  options: PaginationOptions = {},
): Promise<PreparedQuery> => {
  const {
    queries = [],
    searchables = [],
    sortables = [],
    filterables = [],
    getFilterQueries,
  } = options

  const page = Math.max(1, Number(queryParams.pageNumber) || 1)
  const limit = Math.min(100, Math.max(1, Number(queryParams.itemsPerPage) || 10))

  // Build sort
  const sort: Record<string, 1 | -1> = {}
  const sortBy = queryParams.sortBy as string | undefined
  const sortOrder = queryParams.sortOrder as string | undefined
  if (sortBy && sortables.includes(sortBy)) {
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1
  } else {
    sort.createdAt = -1
  }

  // Build filter conditions
  const conditions: Record<string, unknown>[] = [...queries]

  // Add search query (using MongoDB $regex operator with escaped input)
  const searchTerm = queryParams.search as string | undefined
  if (searchTerm && searchables.length > 0) {
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    conditions.push({
      $or: searchables.map((field) => ({
        [field]: { $regex: escaped, $options: 'i' },
      })),
    })
  }

  // Add filterable fields (coerce string values from query params to proper types)
  for (const key of filterables) {
    if (key in queryParams && queryParams[key] !== undefined) {
      conditions.push({ [key]: coerceQueryValue(queryParams[key]) })
    }
  }

  // Add custom filter queries
  if (getFilterQueries) {
    const customFilters = await getFilterQueries(queryParams)
    conditions.push(...customFilters)
  }

  // Combine all conditions
  const query = conditions.length > 0 ? { $and: conditions } : {}

  return { query, page, limit, sort }
}
