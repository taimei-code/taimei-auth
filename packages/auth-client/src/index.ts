export { createAuthClient, createServiceKeyInterceptor } from "./server";
export { createAuthGuard } from "./guard";
export type { ListMembersResult, Member, Role, SessionData, VerifyResult } from "./types";
export { CompanyActivationStatus, Result } from "./gen/auth/v1/auth_pb";
export {
  buildSessionCookieHeader,
  extractSessionTokenFromCookieHeader,
  getSessionToken,
  hasAuthCookie,
  type CookieReader,
} from "./cookie";
export {
  AUTH_ERROR_REASONS,
  buildAccountUrl,
  buildAuthErrorUrl,
  buildAuthLoginUrl,
  buildCompanySignupUrl,
  buildMembersUrl,
  type AuthErrorReason,
  type BuildAuthLoginUrlOptions,
} from "./url-builder";
export { AUTH_RPC_PATH, COMPANY_ID_PATTERN, MAGIC_LINK_EXPIRES_IN_SECONDS } from "./auth-host";
export { isJustSignedUp } from "./auth-host";
