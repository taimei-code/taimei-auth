// session cookie 名と取り出し方を SDK 内に閉じ込める helper。詳細: ADR-004 / ADR-007
// SESSION_COOKIE_NAMES は SDK 外部に export しないこと
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

// 関数型に統一: consumer は framework ごと異なる cookie store shape (Next.js
// `cookies()` / Hono `c.req.cookies` / Express `req.cookies` 等) を lambda で吸収する。
export type CookieReader = (name: string) => string | undefined;

export function getSessionToken(read: CookieReader): string | undefined {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = read(name);
    if (value) return value;
  }
  return undefined;
}

export function hasAuthCookie(read: CookieReader): boolean {
  return getSessionToken(read) !== undefined;
}

// 両 cookie 名 (HTTP / __Secure-) を並べて発行することで、呼出側に環境判定 (http/https) を要求しない。
export function buildSessionCookieHeader(token: string): string {
  return SESSION_COOKIE_NAMES.map((name) => `${name}=${token}`).join("; ");
}

// 値は URL decode しない (現行 IdP は URL-safe な opaque ID のみを発行)
export function extractSessionTokenFromCookieHeader(cookieHeader: string): string | undefined {
  if (!cookieHeader) return undefined;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    // JWT 等で値に '=' を含む可能性があるため、最初の '=' のみで key/value を区切る
    const equalsIndex = pair.indexOf("=");
    if (equalsIndex < 0) continue;
    const key = pair.slice(0, equalsIndex).trim();
    if ((SESSION_COOKIE_NAMES as readonly string[]).includes(key)) {
      return pair.slice(equalsIndex + 1).trim() || undefined;
    }
  }
  return undefined;
}
