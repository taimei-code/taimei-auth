import { extractSessionTokenFromCookieHeader } from "@taimei-code/auth-client/cookie";

export const sessionCookieOf = (headers: Headers): string | undefined =>
  extractSessionTokenFromCookieHeader(headers.get("cookie") ?? "");
