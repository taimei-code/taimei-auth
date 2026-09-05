import type { Effect } from "effect";
import { Context, Layer } from "effect";
import { auth, type Session } from "./auth";
import { type AuthApiError, tryAuthApi } from "./errors";

// better-auth API 面の Effect face (ADR-0017 Decision の依存注入項、語彙は CONTEXT.md Flagged ambiguities)。名前を AuthApi にするのは、同じ file 群が import する better-auth
// instance `auth` (ESM live binding) と読み分けるため。better-auth 自体は Promise / throw 規約の境界なので、
// 失敗は AuthApiError (cause: unknown) に包んで E channel に載せる。`auth` は initAuth() 後の ESM live
// binding のため、live 実装は呼び出し時に auth を参照する (Layer 構築時に束縛しない)。
export class AuthApi extends Context.Service<
  AuthApi,
  {
    getSession(headers: Headers): Effect.Effect<Session | null, AuthApiError>;
    // secondaryStorage (Redis) 側の session 実体を全部消す (DB の revoked_at 記帳と対で使う)。
    deleteUserSessions(userId: string): Effect.Effect<void, AuthApiError>;
    // magic link の発行と送信 (better-auth の magicLink plugin 経由。送信自体は plugin の sendMagicLink callback)。
    signInMagicLink(input: {
      email: string;
      callbackURL: string;
    }): Effect.Effect<void, AuthApiError>;
    // cookieCache (Redis) と DB session を一括 invalidate する。
    signOut(headers: Headers): Effect.Effect<void, AuthApiError>;
  }
>()("taimei/AuthApi") {}

export const AuthApiLive = Layer.succeed(
  AuthApi,
  AuthApi.of({
    getSession: (headers) => tryAuthApi(() => auth.api.getSession({ headers })),
    deleteUserSessions: (userId) =>
      tryAuthApi(async () => {
        const ctx = await auth.$context;
        await ctx.internalAdapter.deleteUserSessions(userId);
      }),
    signInMagicLink: ({ email, callbackURL }) =>
      tryAuthApi(async () => {
        await auth.api.signInMagicLink({ body: { email, callbackURL }, headers: new Headers() });
      }),
    signOut: (headers) =>
      tryAuthApi(async () => {
        await auth.api.signOut({ headers });
      }),
  }),
);
