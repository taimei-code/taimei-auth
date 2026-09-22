import { makeSignature } from "better-auth/crypto";
import { Clock, Effect, Predicate } from "effect";
import { serialize as serializeSetCookie } from "hono/utils/cookie";
import { auth } from "../auth";
import { type AuthApiError, tryAuthApi } from "../errors";
import { captureCause } from "../sentry";
import { ChallengeExpired } from "./error-mapping";

// 呼び出しには headers だけを渡す (request を渡すと originCheck と同じ discriminator の判定を自分で受けてしまう)。

// better-auth の isAPIError は body.code の無い APIError でも真になるため、変換の対象を code 付きに限る。
const hasApiErrorCode = (failure: AuthApiError) =>
  Predicate.isObject(failure.cause) &&
  Predicate.isObject(failure.cause.body) &&
  Predicate.isString(failure.cause.body.code);

export const revokeOtherSessions = Effect.fn("mfa.revokeOtherSessions")(
  function* (headers: Headers) {
    return yield* tryAuthApi(() =>
      auth.api
        .revokeOtherSessions({ headers, returnHeaders: true })
        .then(({ headers: revoked }) => revoked ?? new Headers()),
    );
  },
  Effect.catchIf(hasApiErrorCode, (failure) =>
    captureCause({ tags: { component: "mfa-gateway" } })(failure).pipe(
      Effect.andThen(new ChallengeExpired()),
    ),
  ),
);

// better-call の signCookieValue と同じ形式 (percent-encode 済み)。形式と属性は session-cookie-contract.test.ts で固定している

// 第二要素の検証に成功した後にだけ呼ぶ (ADR-0016)。Max-Age を明示するのは、browser-session cookie になって寿命が変わるのを防ぐため
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
