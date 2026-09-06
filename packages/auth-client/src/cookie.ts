// session cookie 名と取り出し方を SDK 内に閉じ込める helper (SESSION_COOKIE_NAMES は export しない)。
// 詳細: docs/adr/0006-sdk-encapsulation.md / packages/auth-client/CLAUDE.md ルール 7
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

// 関数型に統一: framework ごと異なる cookie store shape を consumer が lambda で吸収する (CLAUDE.md ルール 7 層 3)。
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

// 両 cookie 名 (HTTP / __Secure-) を並べて発行することで、呼出側に環境判定 (http/https) を要求しない。
export function buildSessionCookieHeader(token: string): string {
  return SESSION_COOKIE_NAMES.map((name) => `${name}=${token}`).join("; ");
}

// 値は opaque に扱い decode / encode しない。IdP の発行者 (better-auth 本体 / src/mfa/gateway.ts) はどちらも
// percent-encoded の署名付き値を出し、server がそれを decode して検証するので素通しで往復する (正本は CONTEXT.md
// 「session cookie」、往復は src/__tests__/session-cookie-contract.test.ts が固定)。値自体が '=' を含みうるため、
// 区切りは最初の '=' に限定する。
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
