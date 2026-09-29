import type { Effect } from "effect";
import { Context } from "effect";
import type * as repo from "@/db/repositories/mfa-totp";
import type { AuthApiError, LiftedModule } from "../../errors";
import type { SentryService } from "../../sentry";
import type { ChallengeExpired } from "../error-mapping";
import type { MfaKeyRing } from "./cipher";

export class MfaTotpRepo extends Context.Service<MfaTotpRepo, LiftedModule<typeof repo>>()(
  "taimei/MfaTotpRepo",
) {}

// ring を Effect にして import 時に throw させない。
export class MfaKeyring extends Context.Service<
  MfaKeyring,
  { readonly ring: Effect.Effect<MfaKeyRing> }
>()("taimei/MfaKeyring") {}

export class MfaSessions extends Context.Service<
  MfaSessions,
  {
    revokeOthers(
      headers: Headers,
    ): Effect.Effect<Headers, ChallengeExpired | AuthApiError, SentryService>;
    issueSession(userId: string): Effect.Effect<Headers, AuthApiError>;
  }
>()("taimei/MfaSessions") {}
