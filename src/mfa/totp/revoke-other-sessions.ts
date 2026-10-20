import { Effect } from "effect";
import { AuthApi } from "../../auth-service";
import { Unauthorized } from "../../failures";

export const revokeOtherSessionsOrUnauthorized = (headers: Headers) =>
  AuthApi.use((authApi) => authApi.revokeOtherSessions(headers)).pipe(
    Effect.catchTag("SessionRejected", () => new Unauthorized()),
  );
