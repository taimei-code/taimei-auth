import { makeSignature } from "better-auth/crypto";
import { Clock, Effect, Layer, Predicate } from "effect";
import { serialize as serializeSetCookie } from "hono/utils/cookie";
import { auth } from "./auth";
import { AuthApi, SessionRejected } from "./auth-service";
import { type AuthApiError, tryAuthApi } from "./errors";

const isSessionRejection = ({ cause }: AuthApiError) =>
  Predicate.isObject(cause) && Predicate.isObject(cause.body) && cause.body.code === "UNAUTHORIZED";

export const authApiLive = AuthApi.of({
  getSession: (headers) => tryAuthApi(() => auth.api.getSession({ headers })),
  deleteUserSessions: (userId) =>
    tryAuthApi(async () => {
      const ctx = await auth.$context;
      await ctx.internalAdapter.deleteUserSessions(userId);
    }),
  deleteSession: (token) =>
    tryAuthApi(async () => {
      const ctx = await auth.$context;
      await ctx.internalAdapter.deleteSession(token);
    }),
  // request でなく headers だけを渡す (request を渡すと originCheck の判定を自分で受ける)。
  revokeOtherSessions: (headers) =>
    tryAuthApi(() =>
      auth.api
        .revokeOtherSessions({ headers, returnHeaders: true })
        .then(({ headers: revoked }) => revoked ?? new Headers()),
    ).pipe(Effect.catchIf(isSessionRejection, () => new SessionRejected())),
  // better-call の signCookieValue と同形式 (session-cookie-contract.test.ts が固定)。Max-Age 省略は browser-session cookie になり寿命が変わる。
  issueSession: (userId) =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        tryAuthApi(async () => {
          const authContext = await auth.$context;
          const session = await authContext.internalAdapter.createSession(userId);
          const maxAge = Math.floor((new Date(session.expiresAt).getTime() - now) / 1000);
          const cookie = authContext.createAuthCookie("session_token", { maxAge });
          const signed = `${session.token}.${await makeSignature(session.token, authContext.secret)}`;
          const headers = new Headers();
          headers.append("set-cookie", serializeSetCookie(cookie.name, signed, cookie.attributes));
          return headers;
        }),
      ),
    ),
  signInMagicLink: ({ email, callbackURL }) =>
    tryAuthApi(async () => {
      await auth.api.signInMagicLink({ body: { email, callbackURL }, headers: new Headers() });
    }),
  signOut: (headers) =>
    tryAuthApi(async () => {
      await auth.api.signOut({ headers });
    }),
  secret: tryAuthApi(async () => (await auth.$context).secret),
});

export const AuthApiLive: Layer.Layer<AuthApi> = Layer.succeed(AuthApi, authApiLive);
