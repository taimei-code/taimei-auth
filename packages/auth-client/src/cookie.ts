// session cookie の名前と取り出し方法を SDK 内に閉じ込めるための helper。
// IdP (現状 Better Auth) が決めた cookie 命名規約をプロダクト側に漏らさず、
// 将来の IdP 差し替え時に SDK の 1 ファイル変更で吸収できる構造にする。
// 詳細: ADR-004 (plans/taimei/ADR-004-idp-encapsulation.md) Stage A 参照。
//
// `cookie` パッケージ等の外部依存を持たず手書き parse している理由:
// SDK は peerDependencies を最小化する方針 (現状 ConnectRPC 関連のみ)。
// Cookie ヘッダ parse は仕様 (RFC 6265) が単純で 30 行未満で書けるため、
// 依存追加コスト > 自実装コストと判断。

// HTTP は無印、HTTPS は __Secure- prefix の 2 種類が IdP から発行される。
// この配列は SDK 外部に export しないこと (export すると taimei 側で参照できてしまい、隠蔽の目的に反する)。
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

/** @internal SDK 内部詳細。NextRequest.cookies と Next.js cookies() 戻り値の最小構造を共通化する。 */
interface CookieReader {
  get(name: string): { readonly value: string } | undefined;
}

interface RequestLike {
  readonly cookies: CookieReader;
}

/**
 * Next.js の `cookies()` (Server Component / Server Action) から session token を取り出す。
 * 引数は `await cookies()` の戻り値を期待 (.get(name) が同期で値を返すインターフェース)。
 * `CookieReader` は構造的型なので Next.js 専用ではない (同じ shape を満たす任意の実装が渡せる)。
 */
export function getSessionTokenFromCookieStore(store: CookieReader): string | undefined {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = store.get(name)?.value;
    if (value) return value;
  }
  return undefined;
}

/**
 * NextRequest から session cookie の存在のみを判定する (値の検証はしない)。
 * proxy.ts / middleware で「未認証なら IdP にリダイレクト」判定に使う。
 */
export function hasAuthCookie(request: RequestLike): boolean {
  return getSessionTokenFromCookieStore(request.cookies) !== undefined;
}

/**
 * 生の Cookie ヘッダ文字列 (例: "foo=1; better-auth.session_token=xxx; bar=2")
 * から session token を抽出する。Effect サービス内で `headers().get("cookie")`
 * を直接受け取るユースケース向け。
 *
 * 値は URL decode しない (現行 IdP は URL-safe な opaque ID のみを発行)。
 * IdP が URL-safe でない値を発行する場合は呼び出し側で `decodeURIComponent` すること。
 * 空値 cookie (例: `better-auth.session_token=`) は他 helper との一貫性のため undefined を返す。
 */
export function extractSessionTokenFromCookieHeader(cookieHeader: string): string | undefined {
  if (!cookieHeader) return undefined;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    // JWT 等で値に '=' を含む可能性があるため、最初の '=' のみで key/value を区切る。
    const equalsIndex = pair.indexOf("=");
    if (equalsIndex < 0) continue;
    const key = pair.slice(0, equalsIndex).trim();
    if ((SESSION_COOKIE_NAMES as readonly string[]).includes(key)) {
      return pair.slice(equalsIndex + 1).trim() || undefined;
    }
  }
  return undefined;
}
