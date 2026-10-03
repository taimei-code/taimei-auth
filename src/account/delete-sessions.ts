import { Effect } from "effect";
import { AuthApi } from "../auth-service";
import { captureCause } from "../sentry";

type AccountDeletionFlow = "account-delete" | "company-delete" | "member-remove" | "sweep";

export const deleteSessionsOf = Effect.fn("account.deleteSessionsOf")(function* (
  userIds: readonly string[],
  flow: AccountDeletionFlow,
) {
  yield* Effect.forEach(
    userIds,
    (userId) =>
      AuthApi.use((authApi) => authApi.deleteUserSessions(userId)).pipe(
        Effect.catchTag(
          "AuthApiError",
          captureCause({ tags: { component: "deleteAccount", flow }, extra: { userId } }),
        ),
      ),
    { discard: true },
  );
});
