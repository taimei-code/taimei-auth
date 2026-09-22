// session cookie の名前と取り出し方を SDK の中に閉じ込める helper (SESSION_COOKIE_NAMES は export しない)。
// 詳細は docs/adr/0006-sdk-encapsulation.md と packages/auth-client/CLAUDE.md ルール 7 を参照。
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

// 関数型に統一し、framework ごとに異なる cookie store の形を consumer が lambda で吸収する (CLAUDE.md ルール 7 の層 3)。
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

// 両方の cookie 名 (HTTP 用と __Secure- 付き) を並べて発行することで、呼び出し側に http か https かの環境判定を求めない。
export function buildSessionCookieHeader(token: string): string {
  return SESSION_COOKIE_NAMES.map((name) => `${name}=${token}`).join("; ");
}

// 値は中身を見ずに扱い、decode も encode もしない。IdP の発行者 (better-auth 本体と src/mfa/gateway.ts) はどちらも
// percent-encoded の署名付きの値を出し、server がそれを decode して検証するので、そのまま往復させる (定義は CONTEXT.md
// 「session cookie」にあり、往復は src/__tests__/session-cookie-contract.test.ts が固定する)。値自体が '=' を含みうるため、
// 区切りは最初の '=' に限る。
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
