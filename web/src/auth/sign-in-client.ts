import { createAuthClient } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { Effect, Option } from "effect";

export const signInClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? `${window.location.origin}/api/auth` : "",
  plugins: [magicLinkClient()],
  // oxlint-disable-next-line taimei/no-fetch-in-web
  fetchOptions: { customFetchImpl: (input, init) => fetch(input, init) },
});

export const readSession = Effect.tryPromise(() => signInClient.getSession());

export const checkSession = readSession.pipe(Effect.map(({ data }) => Boolean(data?.session)));

export const readSignedInUserId = readSession.pipe(
  Effect.map(({ data }) => Option.fromNullishOr(data?.user.id)),
);
