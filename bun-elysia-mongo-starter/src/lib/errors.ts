export type ErrorCode =
  // Generic errors
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

// Helper functions for creating common errors
export const createInternalError = (message = 'An internal error occurred') =>
  new AppError('INTERNAL_ERROR', message)
