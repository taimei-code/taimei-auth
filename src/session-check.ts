import { Effect } from "effect";
import type { UserRow } from "@/db/repositories/user";
import { UserRepo } from "./account/ports";
import type { Session } from "./auth";
import { AuthApi } from "./auth-service";
import type { AuthApiError, DbError } from "./errors";

type SessionStatus =
  | { readonly _tag: "NoSession" }
  | { readonly _tag: "UserDeleted" }
  | { readonly _tag: "Active"; readonly session: Session; readonly user: UserRow };

export const checkSession = Effect.fnUntraced(function* (
  headers: Headers,
): Effect.fn.Return<SessionStatus, AuthApiError | DbError, AuthApi | UserRepo> {
  const session = yield* AuthApi.use((authApi) => authApi.getSession(headers));
  if (!session?.session || !session.user?.id) return { _tag: "NoSession" };
  const user = yield* UserRepo.use((users) => users.findUserById(session.user.id));
  return user ? { _tag: "Active", session, user } : { _tag: "UserDeleted" };
});
