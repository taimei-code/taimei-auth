import type { Effect } from "effect";
import { Context } from "effect";
import type * as repo from "@/db/repositories/mfa-totp";
import type { Background } from "../../background";
import type { EmailSender } from "../../email/ports";
import type { AuthApiError, LiftedModule } from "../../errors";
import type { TtlStore } from "../../ttl-store-service";
import type { SentryService } from "../../sentry";
import type { ChallengeExpired, Locked } from "../error-mapping";
import type { MfaKeyRing } from "./cipher";

export class MfaTotpRepo extends Context.Service<MfaTotpRepo, LiftedModule<typeof repo>>()(
  "taimei/MfaTotpRepo",
) {}

// 鍵 ring は env から遅延して解決し、import 時に throw させない。
export class MfaKeyring extends Context.Service<
  MfaKeyring,
  { readonly ring: Effect.Effect<MfaKeyRing> }
>()("taimei/MfaKeyring") {}

export class MfaIssuer extends Context.Service<
  MfaIssuer,
  { readonly appName: Effect.Effect<string> }
>()("taimei/MfaIssuer") {}

// port の名前を gateway の名前と変えるのは、gateway 名が現れる場所を wiring だけに限るため。
export class MfaSessions extends Context.Service<
  MfaSessions,
  {
    revokeOthers(
      headers: Headers,
    ): Effect.Effect<Headers, ChallengeExpired | AuthApiError, SentryService>;
    issueSession(userId: string): Effect.Effect<Headers, AuthApiError>;
  }
>()("taimei/MfaSessions") {}

export class MfaNotifier extends Context.Service<
  MfaNotifier,
  {
    notifyEnabled(
      email: string,
    ): Effect.Effect<void, never, EmailSender | Background | SentryService>;
    notifyDisabled(
      email: string,
    ): Effect.Effect<void, never, EmailSender | Background | SentryService>;
  }
>()("taimei/MfaNotifier") {}

// 数えられないときも Locked にする (fail-closed)。根拠は CONTEXT.md「試行枠」
export class MfaDisableBudget extends Context.Service<
  MfaDisableBudget,
  {
    spend(userId: string): Effect.Effect<void, Locked, TtlStore | SentryService>;
    reset(userId: string): Effect.Effect<void, never, TtlStore | SentryService>;
  }
>()("taimei/MfaDisableBudget") {}
