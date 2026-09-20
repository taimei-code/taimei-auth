import { Layer } from "effect";
import { auth } from "./auth";
import { AuthApi } from "./auth-service";
import { tryAuthApi } from "./errors";

export const AuthApiLive: Layer.Layer<AuthApi> = Layer.succeed(
  AuthApi,
  AuthApi.of({
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
    signInMagicLink: ({ email, callbackURL }) =>
      tryAuthApi(async () => {
        await auth.api.signInMagicLink({ body: { email, callbackURL }, headers: new Headers() });
      }),
    signOut: (headers) =>
      tryAuthApi(async () => {
        await auth.api.signOut({ headers });
      }),
    secret: tryAuthApi(async () => (await auth.$context).secret),
  }),
);
