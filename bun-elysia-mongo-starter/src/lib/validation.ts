import type { ZodError } from 'zod'

export const formatValidationErrors = (error: ZodError): string =>
  error.issues.map((issue) => issue.message).join(', ')
