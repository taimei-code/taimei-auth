import type { Effect } from "effect";
import { Context } from "effect";
import type { Session } from "./auth";
import type { AuthApiError } from "./errors";

export class AuthApi extends Context.Service<
  AuthApi,
  {
    getSession(headers: Headers): Effect.Effect<Session | null, AuthApiError>;
    deleteUserSessions(userId: string): Effect.Effect<void, AuthApiError>;
    deleteSession(token: string): Effect.Effect<void, AuthApiError>;
    signInMagicLink(input: {
      email: string;
      callbackURL: string;
    }): Effect.Effect<void, AuthApiError>;
    signOut(headers: Headers): Effect.Effect<void, AuthApiError>;
    readonly secret: Effect.Effect<string, AuthApiError>;
  }
>()("taimei/AuthApi") {}
