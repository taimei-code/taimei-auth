import { makeSignature } from "better-auth/crypto";
import { Clock, Effect } from "effect";
import { serialize as serializeSetCookie } from "hono/utils/cookie";
import { auth } from "../auth";
import { type AuthApiError, tryAuthApi } from "../errors";
import { captureCause, type SentryService } from "../sentry";
import { ChallengeExpired } from "./error-mapping";

// better-auth (auth.api / auth.$context) への唯一の正規窓口 (縮退後の残置面: ADR-0016)。
// すべての呼び出しで headers のみを渡し request を渡さないこと (originCheck と同じ discriminator を
// 自分の呼び出しで踏まないため)。better-auth は Promise / throw 規約の境界なので、失敗は
// AuthApiError (cause: unknown) に包んで E channel に載せる (ADR-0017 Decision の boundary error 項)。

// secondaryStorage 構成では session 実体が Redis にしか無いため、これが既存セッション失効の唯一の経路。
export const revokeOtherSessions = Effect.fn("mfa.revokeOtherSessions")(function* (
  headers: Headers,
) {
  return yield* tryAuthApi(() =>
    auth.api
      .revokeOtherSessions({ headers, returnHeaders: true })
      .then(({ headers: revoked }) => revoked ?? new Headers()),
  ).pipe(Effect.catchTag("AuthApiError", foldToChallengeExpired));
});

// better-auth 由来 (body.code 持ち APIError) は fail-closed に challenge_expired へ畳んで観測し、それ以外は boundary
// error のまま adapter (500 + Sentry) に渡す。写像表は持たない — 発生源の twoFactor プラグインが消えたため。
const foldToChallengeExpired = (
  error: AuthApiError,
): Effect.Effect<never, ChallengeExpired | AuthApiError, SentryService> =>
  Effect.gen(function* () {
    if (!hasApiErrorBody(error.cause)) return yield* Effect.fail(error);
    yield* captureCause({ tags: { component: "mfa-gateway" } })(error);
    return yield* new ChallengeExpired();
  });

// body.code を構造的に読む — catch した値が本当に APIError である保証は型に無い (better-auth の isAPIError は
// body.code を持たない APIError も真にするため、写像対象を「code 付き」に限る現行の判定を保つ)。
function hasApiErrorBody(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { body } = error as { body?: unknown };
  if (typeof body !== "object" || body === null) return false;
  return typeof (body as { code?: unknown }).code === "string";
}

// session cookie の wire 形式の正本 (CONTEXT.md「session cookie」)。値は `<token>.<標準 base64 署名 44 文字>` を
// percent-encode したもので、better-auth 本体 (better-call の signCookieValue) と同じ形。hono の serialize が
// encodeURIComponent と属性の直列化を担い、属性は createAuthCookie のものをそのまま渡す (手写ししない)。
// `__Secure-` 名に Secure が無い構成は hono が throw し、Secure 無しの cookie を黙って出さない。
// server は better-call の parseCookies が `%` を含む値を decodeURIComponent してから署名を検証するので、
// 過去に raw で発行した cookie も受理する。SDK (packages/auth-client/src/cookie.ts) は値を decode しない。
// 固定する test: src/__tests__/session-cookie-contract.test.ts (形式 / 往復 / 属性同一性)、
// src/mfa/__tests__/containment.test.ts AC-150f (手組みへの逆戻りを拾う静的 tripwire)。

// チャレンジ通過確定後の session 発行窓口。本人確認はしない — 呼び出しは「第二要素の検証成功が
// 確定した後」に限る契約 (ADR-0016 / PoC 0003)。Max-Age を明示付与しないと browser-session cookie に
// なり通常ログインと寿命が揺れる。cookieCache (session_data) は発行時に作らない (次リクエストの
// getSession が担う。機能差なし)。
export const issueSessionFor = Effect.fn("mfa.issueSessionFor")(function* (userId: string) {
  const now = yield* Clock.currentTimeMillis;
  return yield* tryAuthApi(async () => {
    const authContext = await auth.$context;
    const session = await authContext.internalAdapter.createSession(userId);
    const maxAge = Math.floor((new Date(session.expiresAt).getTime() - now) / 1000);
    const cookie = authContext.createAuthCookie("session_token", { maxAge });
    const signed = `${session.token}.${await makeSignature(session.token, authContext.secret)}`;
    const headers = new Headers();
    headers.append("set-cookie", serializeSetCookie(cookie.name, signed, cookie.attributes));
    return headers;
  });
});
