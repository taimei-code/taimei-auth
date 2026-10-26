import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { isSessionToken } from "../ttl-key";

const REVOKE_SESSION_ROUTE = "/revoke-session";
const TOKEN_OF_NO_SESSION = "";

export const revokeOnlySessionTokens = (): BetterAuthPlugin => ({
  id: "revoke-only-session-tokens",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === REVOKE_SESSION_ROUTE,
        handler: createAuthMiddleware(async (ctx) =>
          isSessionToken(ctx.body?.token)
            ? undefined
            : { context: { body: { token: TOKEN_OF_NO_SESSION } } },
        ),
      },
    ],
  },
});
