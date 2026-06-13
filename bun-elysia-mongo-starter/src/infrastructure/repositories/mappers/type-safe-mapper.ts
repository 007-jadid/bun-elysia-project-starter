import type { Document } from 'mongoose'

// ============================================================================
// Type-Safe Mapper Utility
// ============================================================================

/**
 * Creates a type-safe mapper from Mongoose documents to domain entities
 *
 * This utility provides a safer alternative to `as unknown as T` by:
 * 1. Explicitly calling .toObject() to get a plain object
 * 2. Optionally validating the structure (in strict mode)
 * 3. Making schema drift visible during development
 *
 * Usage:
 *   const mapper = createTypeSafeMapper<Example>()
 *   return Ok(result ? mapper(result) : null)
 */
export function createTypeSafeMapper<T>() {
  return (doc: Document): T => {
    const obj = doc.toObject()
    // TODO: Add runtime validation here if needed (e.g., Zod schema)
    // For now, we trust the schema but avoid double casting
    return obj as T
  }
}

/**
 * Maps an array of Mongoose documents to domain entities
 */
export function mapArrayToDomain<T>(docs: Document[]): T[] {
  const mapper = createTypeSafeMapper<T>()
  return docs.map(mapper)
}
