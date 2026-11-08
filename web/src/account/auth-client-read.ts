import { Data, Effect } from "effect";

import { signInClient } from "../auth/sign-in-client";

class AuthClientReadFailed extends Data.TaggedError("AuthClientReadFailed") {}

type AuthClientResponse<A> = Readonly<{ data: A | null; error: unknown }>;

const readAuthClient = <A>(read: () => Promise<AuthClientResponse<A>>) =>
  Effect.tryPromise({ try: read, catch: () => new AuthClientReadFailed() }).pipe(
    Effect.flatMap(({ data, error }) =>
      error === null && data !== null
        ? Effect.succeed(data)
        : Effect.fail(new AuthClientReadFailed()),
    ),
  );

export const listSessions = readAuthClient(() => signInClient.listSessions());

export const listLinkedAccounts = readAuthClient(() => signInClient.listAccounts());
