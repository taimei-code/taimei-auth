import { Effect } from "effect";
import { AuthApi } from "../auth-service";
import { captureCause } from "../sentry";

export type AccountDeletionFlow = "account-delete" | "company-delete" | "member-remove" | "sweep";

export const deleteSessionsOf = (userId: string, flow: AccountDeletionFlow) =>
  AuthApi.use((authApi) => authApi.deleteUserSessions(userId)).pipe(
    Effect.catchTag(
      "AuthApiError",
      captureCause({ tags: { component: "deleteAccount", flow }, extra: { userId } }),
    ),
  );
