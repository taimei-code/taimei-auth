import { makeSignature } from "better-auth/crypto";
import { Clock, Effect, Predicate } from "effect";
import { serialize as serializeSetCookie } from "hono/utils/cookie";
import { auth } from "../auth";
import { type AuthApiError, tryAuthApi } from "../errors";
import { captureCause } from "../sentry";
import { ChallengeExpired } from "./error-mapping";

// request でなく headers だけを渡す (request を渡すと originCheck の判定を自分で受ける)。

// better-auth の isAPIError は body.code の無い APIError でも真になる。
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

// 第二要素の検証成功後にだけ呼ぶ。better-call の signCookieValue と同形式 (session-cookie-contract.test.ts が固定)。Max-Age 省略は browser-session cookie になり寿命が変わる。
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
