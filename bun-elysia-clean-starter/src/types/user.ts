/**
 * User types in the system — values must match what your auth/gateway service
 * puts in the JWT `UserType` claim. Adjust this enum to match the issuer your
 * service trusts.
 */
export enum UserTypeEnum {
  CUSTOMER = "Customer",
  ADMIN = "Admin",
  CMS = "CMS",
}

/**
 * JWT payload as issued by your auth service. Only `id` is guaranteed here;
 * everything else is optional so the verifier never enforces claims a legacy
 * issuer might omit (e.g. iss/aud are absent on purpose — see auth.middleware).
 */
export interface JWTPayload {
  id: number;
  UserType?: UserTypeEnum | undefined;
  FirstName?: string | undefined;
  LastName?: string | undefined;
  UserName?: string | undefined;
  jti?: string | undefined;
  iat?: number | undefined;
  /** Expiry, seconds since epoch (standard JWT `exp`). */
  exp?: number | undefined;
  iss?: string | undefined;
  aud?: string | undefined;
}

/**
 * Authenticated user as exposed to handlers after `requireAuth` validation.
 * `UserType` is guaranteed (the middleware rejects tokens without a valid one);
 * names stay optional because legacy tokens may omit them.
 */
export interface AuthUser {
  id: number;
  UserType: UserTypeEnum;
  FirstName?: string | undefined;
  LastName?: string | undefined;
  UserName?: string | undefined;
}
