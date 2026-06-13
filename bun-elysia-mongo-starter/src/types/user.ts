// ============================================================================
// User Type Enums
// ============================================================================

/**
 * User types in the system — values must match what your auth/gateway service
 * puts in the JWT `UserType` claim. Adjust to match your issuer.
 */
export enum UserTypeEnum {
  CUSTOMER = 'Customer',
  ADMIN = 'Admin',
  CMS = 'CMS',
}

// ============================================================================
// Authenticated User Types
// ============================================================================

/**
 * User information extracted from the JWT token.
 */
export interface AuthUser {
  id: number
  UserType: UserTypeEnum
  FirstName: string
  LastName: string
  UserName: string
}

/**
 * JWT payload structure matching the token format.
 */
export interface JWTPayload {
  sub?: string
  userId?: string | number
  id: number
  UserType: UserTypeEnum
  FirstName: string
  LastName: string
  UserName: string
  email?: string
  roles?: string[]
  jti?: string
  iat?: number
  exp?: number
  iss?: string
  aud?: string
}
