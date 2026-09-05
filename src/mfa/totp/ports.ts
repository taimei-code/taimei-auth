import type { Effect } from "effect";
import { Context } from "effect";
import type * as repo from "@/db/repositories/mfa-totp";
import type { Background } from "../../background";
import type { EmailSender } from "../../email/ports";
import type { AuthApiError, LiftedModule } from "../../errors";
import type { Redis } from "../../redis-service";
import type { SentryService } from "../../sentry";
import type { ChallengeExpired, Locked } from "../error-mapping";
import type { MfaKeyRing } from "./cipher";

// MFA domain の ports (ADR-0017 Decision の境界表 1 行目と依存注入項)。use-case はこの service を yield* し、
// db/repositories・gateway・notification-adapter を直接 import しない (結線は wiring.ts のみ)。

// Repository (db/repositories/mfa-totp、Promise) の Effect face。identity DB を別 process (RPC) へ
// 分離する時はこの interface の live 実装だけを差し替える (型導出の規則は src/CLAUDE.md の Effect様式)。
export class MfaTotpRepo extends Context.Service<MfaTotpRepo, LiftedModule<typeof repo>>()(
  "taimei/MfaTotpRepo",
) {}

// 鍵 ring は env から遅延解決する — import 時に throw させない (kill-switch と同じ方針)。
// 解決失敗 (env 不正) は業務失敗ではないため E channel に載せず defect のままにする。
export class MfaKeyring extends Context.Service<
  MfaKeyring,
  { readonly ring: Effect.Effect<MfaKeyRing> }
>()("taimei/MfaKeyring") {}

// otpauth URI に載る発行者名 (認証アプリの表示名)。
export class MfaIssuer extends Context.Service<
  MfaIssuer,
  { readonly appName: Effect.Effect<string> }
>()("taimei/MfaIssuer") {}

// port 名を revokeOthers / issueSession にするのは gateway 名 (revokeOtherSessions / issueSessionFor) の
// 出現を wiring に閉じるため。
export class MfaSessions extends Context.Service<
  MfaSessions,
  {
    revokeOthers(
      headers: Headers,
    ): Effect.Effect<Headers, ChallengeExpired | AuthApiError, SentryService>;
    issueSession(userId: string): Effect.Effect<Headers, AuthApiError>;
  }
>()("taimei/MfaSessions") {}

// 通知は失敗しない契約 (notification-adapter が catch を内蔵する)。
export class MfaNotifier extends Context.Service<
  MfaNotifier,
  {
    notifyEnabled(email: string): Effect.Effect<void, never, EmailSender | Background>;
    notifyDisabled(email: string): Effect.Effect<void, never, EmailSender | Background>;
  }
>()("taimei/MfaNotifier") {}

// 無効化の総当たり防御 (Redis 計数)。fail-closed = 数えられない時も Locked。
export class MfaDisableBudget extends Context.Service<
  MfaDisableBudget,
  {
    spend(userId: string): Effect.Effect<void, Locked, Redis | SentryService>;
    reset(userId: string): Effect.Effect<void, never, Redis | SentryService>;
  }
>()("taimei/MfaDisableBudget") {}
