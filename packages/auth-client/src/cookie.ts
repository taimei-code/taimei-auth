const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

export type CookieReader = (name: string) => string | undefined;

export function getSessionToken(readCookie: CookieReader): string | undefined {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = readCookie(name);
    if (value) return value;
  }
  return undefined;
}

export function hasAuthCookie(readCookie: CookieReader): boolean {
  return getSessionToken(readCookie) !== undefined;
}

// 両方の名前で発行し、呼び出し側に http / https の判定を求めない。
export function buildSessionCookieHeader(token: string): string {
  return SESSION_COOKIE_NAMES.map((name) => `${name}=${token}`).join("; ");
}

// 値は decode せず server にそのまま渡す。値自体が '=' を含みうるので区切りは最初の '=' に限る。
export function extractSessionTokenFromCookieHeader(cookieHeader: string): string | undefined {
  if (!cookieHeader) return undefined;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const equalsIndex = pair.indexOf("=");
    if (equalsIndex < 0) continue;
    const key = pair.slice(0, equalsIndex).trim();
    if ((SESSION_COOKIE_NAMES as readonly string[]).includes(key)) {
      return pair.slice(equalsIndex + 1).trim() || undefined;
    }
  }
  return undefined;
}
