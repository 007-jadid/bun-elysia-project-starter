// Shared pagination contract. Param names match the response wrapper in
// http/schemas/common.ts.

export interface PaginationQueryParams {
  pageNumber?: number;
  itemsPerPage?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pageNumber: number;
  itemsPerPage: number;
  totalItems: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Clamp raw query params to sane bounds. */
export const normalizePagination = (
  params: PaginationQueryParams,
): { page: number; limit: number; offset: number } => {
  const page = Math.max(1, Math.floor(params.pageNumber ?? 1));
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(params.itemsPerPage ?? DEFAULT_PAGE_SIZE)),
  );
  return { page, limit, offset: (page - 1) * limit };
};
