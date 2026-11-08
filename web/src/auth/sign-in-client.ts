import { createAuthClient } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { Effect } from "effect";

export const signInClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? `${window.location.origin}/api/auth` : "",
  plugins: [magicLinkClient()],
});

export const checkSession = Effect.tryPromise(() => signInClient.getSession()).pipe(
  Effect.map(({ data }) => Boolean(data?.session)),
);
