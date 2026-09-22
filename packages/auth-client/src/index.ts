export { createAuthClient, createServiceKeyInterceptor, mapConnectError } from "./server";
export { createAuthGuard } from "./guard";
export type { SessionData, VerifyResult } from "./types";
// VerifyResult.reason が取りうる値として consumer に Result enum を公開する
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
