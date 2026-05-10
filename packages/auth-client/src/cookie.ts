// session cookie 名と取り出し方を SDK 内に閉じ込める helper。詳細: docs/adr/0006-sdk-encapsulation.md
// SESSION_COOKIE_NAMES は SDK 外部に export しないこと
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

interface CookieReader {
  get(name: string): { readonly value: string } | undefined;
}

interface RequestLike {
  readonly cookies: CookieReader;
}

export function getSessionTokenFromCookieStore(store: CookieReader): string | undefined {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = store.get(name)?.value;
    if (value) return value;
  }
  return undefined;
}

export function hasAuthCookie(request: RequestLike): boolean {
  return getSessionTokenFromCookieStore(request.cookies) !== undefined;
}

// HTTP 用と HTTPS 用 (Secure prefix) の両 cookie 名を提示する: better-auth が適切な方を採用するため、呼出側で環境判定が要らない。
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
