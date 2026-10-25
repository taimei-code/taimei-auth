const SESSION_COOKIE_NAME = "__Secure-better-auth.session_token";

export type CookieReader = (name: string) => string | undefined;

export function getSessionToken(readCookie: CookieReader): string | undefined {
  return readCookie(SESSION_COOKIE_NAME) || undefined;
}

export function hasAuthCookie(readCookie: CookieReader): boolean {
  return getSessionToken(readCookie) !== undefined;
}

export function buildSessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

export function extractSessionTokenFromCookieHeader(cookieHeader: string): string | undefined {
  for (const pair of cookieHeader.split(";")) {
    const equalsIndex = pair.indexOf("=");
    if (equalsIndex < 0) continue;
    if (pair.slice(0, equalsIndex).trim() === SESSION_COOKIE_NAME) {
      return pair.slice(equalsIndex + 1).trim() || undefined;
    }
  }
  return undefined;
}
