export { createAuthClient, createServiceKeyInterceptor, mapConnectError } from "./server";
export { createAuthGuard } from "./guard";
export type { SessionData, VerifyResult } from "./types";
export { Result } from "./gen/auth/v1/auth_pb";
export {
  buildSessionCookieHeader,
  extractSessionTokenFromCookieHeader,
  getSessionToken,
  hasAuthCookie,
  type CookieReader,
} from "./cookie";
export {
  AuthServiceUnavailable,
  AuthServiceTimeout,
  AuthServiceUnauthorized,
} from "./errors";
export {
  buildAuthLoginUrl,
  buildAuthLogoutUrl,
  type BuildAuthLoginUrlOptions,
  type BuildAuthLogoutUrlOptions,
} from "./url-builder";
