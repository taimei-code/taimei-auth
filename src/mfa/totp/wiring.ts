import { Effect, Layer } from "effect";
import * as repo from "@/db/repositories/mfa-totp";
import { getAppName } from "../../email/client";
import { liftDb } from "../../errors";
import { resetDisableAttempts, spendDisableAttempt } from "../disable-attempt-budget";
import { issueSessionFor, revokeOtherSessions } from "../gateway";
import { notifyMfaDisabled, notifyMfaEnabled } from "../notification-adapter";
import { type MfaKeyRing, parseMfaKeyRing } from "./cipher";
import {
  MfaDisableBudget,
  MfaIssuer,
  MfaKeyring,
  MfaNotifier,
  MfaSessions,
  MfaTotpRepo,
} from "./ports";

// production 結線 (A-11)。gateway 名 (revokeOtherSessions / issueSessionFor) の出現はこのファイルに閉じる。
// module ロード時 bind の根拠は src/membership/wiring.ts と同じ (db/CLAUDE.md の workerd gotcha)。

export const MfaTotpRepoLive = Layer.succeed(
  MfaTotpRepo,
  MfaTotpRepo.of({
    findMfaTotp: liftDb(repo.findMfaTotp),
    readMfaVerification: liftDb(repo.readMfaVerification),
    readMfaStatusRow: liftDb(repo.readMfaStatusRow),
    insertMfaTotpEnrollment: liftDb(repo.insertMfaTotpEnrollment),
    activateMfaTotp: liftDb(repo.activateMfaTotp),
    consumeTotpTimestep: liftDb(repo.consumeTotpTimestep),
    deleteMfaTotp: liftDb(repo.deleteMfaTotp),
    insertRecoveryCodes: liftDb(repo.insertRecoveryCodes),
    listUnusedRecoveryCodes: liftDb(repo.listUnusedRecoveryCodes),
    consumeRecoveryCode: liftDb(repo.consumeRecoveryCode),
    deleteRecoveryCodesByUserId: liftDb(repo.deleteRecoveryCodesByUserId),
  }),
);

// 鍵 ring は env から遅延解決する — import 時に throw させない (kill-switch と同じ方針)。
let cached: MfaKeyRing | undefined;

export const MfaKeyringLive = Layer.succeed(
  MfaKeyring,
  MfaKeyring.of({
    ring: Effect.sync(() => (cached ??= parseMfaKeyRing(process.env.MFA_TOTP_ENCRYPTION_KEYS))),
  }),
);

export const MfaIssuerLive = Layer.succeed(
  MfaIssuer,
  MfaIssuer.of({ appName: Effect.sync(getAppName) }),
);

export const MfaSessionsLive = Layer.succeed(
  MfaSessions,
  MfaSessions.of({ revokeOthers: revokeOtherSessions, issueSession: issueSessionFor }),
);

// 有効化 / 無効化の通知の取り違えは「無効化したのに有効化メールが届く」で、利用者からは乗っ取りに見える。
export const MfaNotifierLive = Layer.succeed(
  MfaNotifier,
  MfaNotifier.of({
    notifyEnabled: notifyMfaEnabled,
    notifyDisabled: notifyMfaDisabled,
  }),
);

export const MfaDisableBudgetLive = Layer.succeed(
  MfaDisableBudget,
  MfaDisableBudget.of({ spend: spendDisableAttempt, reset: resetDisableAttempts }),
);

export const MfaLayers = Layer.mergeAll(
  MfaTotpRepoLive,
  MfaKeyringLive,
  MfaIssuerLive,
  MfaSessionsLive,
  MfaNotifierLive,
  MfaDisableBudgetLive,
);
