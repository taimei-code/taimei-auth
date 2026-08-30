import { makeSignature } from "better-auth/crypto";
import { auth } from "../auth";
import { Sentry } from "../sentry";
import { CHALLENGE_EXPIRED, failure, type MfaFailure } from "./error-mapping";

// better-auth (auth.api / auth.$context) への唯一の正規窓口 (縮退後の残置面: ADR-0016)。
// すべての呼び出しで headers のみを渡し request を渡さないこと (originCheck と同じ discriminator を
// 自分の呼び出しで踏まないため)。

export type SessionRevocationResult = { ok: true; headers: Headers } | MfaFailure;

// secondaryStorage 構成では session 実体が Redis にしか無いため、これが既存セッション失効の唯一の経路。
// better-auth 由来 (body.code 持ち APIError) は fail-closed に challenge_expired へ畳んで観測し、
// それ以外は rethrow する。写像表は持たない — 発生源の twoFactor プラグインが消えたため。
export function revokeOtherSessions(headers: Headers): Promise<SessionRevocationResult> {
  return auth.api
    .revokeOtherSessions({ headers, returnHeaders: true })
    .then(({ headers: revoked }) => ({ ok: true as const, headers: revoked ?? new Headers() }))
    .catch((error: unknown) => {
      if (!hasApiErrorBody(error)) throw error;
      Sentry.captureException(error, { tags: { component: "mfa-gateway" } });
      return failure(CHALLENGE_EXPIRED);
    });
}

// body.code を構造的に読む — catch した値が本当に APIError である保証は型に無い。
function hasApiErrorBody(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { body } = error as { body?: unknown };
  if (typeof body !== "object" || body === null) return false;
  return typeof (body as { code?: unknown }).code === "string";
}

// チャレンジ通過確定後の session 発行窓口。本人確認はしない — 呼び出しは「第二要素の検証成功が
// 確定した後」に限る契約 (ADR-0016 / PoC 0003)。Max-Age を明示付与しないと browser-session cookie に
// なり通常ログインと寿命が揺れる。cookieCache (session_data) は発行時に作らない (次リクエストの
// getSession が担う。機能差なし)。
export async function issueSessionFor(userId: string): Promise<Headers> {
  const authContext = await auth.$context;
  const session = await authContext.internalAdapter.createSession(userId);
  const maxAge = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);
  const cookie = authContext.createAuthCookie("session_token", { maxAge });
  const signed = `${session.token}.${await makeSignature(session.token, authContext.secret)}`;
  const headers = new Headers();
  headers.append("set-cookie", serializeRawSessionCookie(cookie.name, signed, cookie.attributes));
  return headers;
}

type SessionCookieAttributes = {
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string | boolean;
  maxAge?: number;
};

// 値を percent-encode しない — better-auth 発行の同名 cookie は raw で、SDK
// (packages/auth-client/src/cookie.ts) は「URL decode しない」を契約にしている。hono の serialize は
// 常に encodeURIComponent するため使えない。base64 の +/=/ は cookie-value として有効。
function serializeRawSessionCookie(
  name: string,
  value: string,
  attributes: SessionCookieAttributes,
): string {
  const parts = [`${name}=${value}`];
  if (attributes.maxAge !== undefined) parts.push(`Max-Age=${attributes.maxAge}`);
  parts.push(`Path=${attributes.path ?? "/"}`);
  if (attributes.domain) parts.push(`Domain=${attributes.domain}`);
  if (attributes.httpOnly) parts.push("HttpOnly");
  if (attributes.secure) parts.push("Secure");
  if (typeof attributes.sameSite === "string" && attributes.sameSite !== "") {
    parts.push(
      `SameSite=${attributes.sameSite.charAt(0).toUpperCase()}${attributes.sameSite.slice(1).toLowerCase()}`,
    );
  }
  return parts.join("; ");
}
