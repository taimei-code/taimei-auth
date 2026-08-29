import { createActivate } from "../registration/activate";
import { createRegistrationApplication } from "../registration/application";
import { createDisable } from "../registration/disable";
import { enroll } from "../registration/enroll";
import { CHALLENGE_EXPIRED, failure, LOCKED, type MfaFailure } from "../error-mapping";
import type {
  GuardedMfaGateway,
  GuardHold,
  RegistrationOperations,
  RegistrationSnapshot,
  TransitionGuard,
} from "../registration/ports";
import type { ReportUnknownTransition } from "../registration/transition";
import { makeGuardHold } from "./test-doubles";

type SessionStep = "verify" | "revoke" | "activateTotp" | "disableTotp";
type ThrowFaultStep = SessionStep | "audit";

export type RegistrationFault =
  // readPending が known 限定なのは本物が総写像のため (正本: ADR-0013 §8、観測: gateway.test)。
  | { step: "spend" | "readPending"; mode: "known" }
  | { step: SessionStep; mode: "known" | "throw" }
  | { step: "audit"; mode: "throw" };

// 登録済み未有効 — enroll は replay 分岐 (readPendingTotpEnrollment) に入る。activate と同じ前提状態。
const pendingEnrollmentSnapshot: RegistrationSnapshot = {
  user: "present",
  email: "snapshot@example.com",
  twoFactorEnabled: false,
  enrollment: { id: "enrollment-1", verified: false },
};

const acceptedSnapshotsByOperation: Record<
  "activate" | "disable" | "enroll",
  RegistrationSnapshot
> = {
  activate: pendingEnrollmentSnapshot,
  enroll: pendingEnrollmentSnapshot,
  disable: {
    user: "present",
    email: "snapshot@example.com",
    twoFactorEnabled: true,
    enrollment: { id: "enrollment-1", verified: true },
  },
};

const successfulSessionMutation = (cookie: string) => ({
  ok: true as const,
  headers: new Headers([["set-cookie", cookie]]),
});

export function createRegistrationFaultHarness(options: {
  operation: "activate" | "disable" | "enroll";
  fault?: RegistrationFault;
  snapshot?: RegistrationSnapshot;
}) {
  const ledger: string[] = [];
  const notifications: string[] = [];
  const observedAuditErrors: unknown[] = [];
  const transitionReports: Parameters<ReportUnknownTransition>[0][] = [];
  const releasedHolds: GuardHold[] = [];
  const faultError = new Error(`${options.operation}:${options.fault?.step ?? "success"}`);
  let activeHold: GuardHold | undefined;

  const throwAt = (step: ThrowFaultStep): void => {
    if (options.fault?.step === step && options.fault.mode === "throw") throw faultError;
  };
  const knownFailureAt = (
    step: Exclude<RegistrationFault["step"], "audit">,
  ): MfaFailure | undefined => {
    if (options.fault?.step !== step || options.fault.mode !== "known") return undefined;
    switch (step) {
      case "spend":
        return failure(LOCKED);
      case "verify":
      case "activateTotp":
        return failure({ error: "invalid_code", status: 400 });
      case "revoke":
      case "disableTotp":
      case "readPending":
        return failure(CHALLENGE_EXPIRED);
    }
  };

  const guard: TransitionGuard = {
    acquire: async (userId, operation) => {
      ledger.push("acquire");
      if (activeHold) {
        return { acquired: false, cause: "held", heldSince: new Date() };
      }
      if (operation !== options.operation) {
        throw new Error(`expected ${options.operation}, received ${operation}`);
      }
      activeHold = makeGuardHold({
        userId,
        token: `guard-${operation}`,
        operation,
        snapshot: options.snapshot ?? acceptedSnapshotsByOperation[operation],
      });
      return { acquired: true, hold: activeHold };
    },
    release: async (hold) => {
      ledger.push("release");
      releasedHolds.push(hold);
      activeHold = undefined;
      return { released: true };
    },
  };

  // known → throw → 成功、の順序が seam の意味そのもの。4 メソッド分をここで 1 回だけ固定する。
  const sessionStep = (step: SessionStep, cookie: string) => async () => {
    ledger.push(step);
    const known = knownFailureAt(step);
    if (known) return known;
    throwAt(step);
    return successfulSessionMutation(cookie);
  };

  // runTransition が配る遷移内窓口の fake。production の束縛 (wiring.guardedGateway) と同じ関数選定。
  const guardedGateway = (_hold: GuardHold): GuardedMfaGateway => ({
    enrollTotp: async () => {
      // 新規登録分岐は実 DB (findTwoFactorVerificationState) を要するため fault harness の対象外。
      throw new Error("not used: fresh-enroll branch requires the real DB");
    },
    readPendingTotpEnrollment: async () => {
      ledger.push("readPending");
      const known = knownFailureAt("readPending");
      if (known) return known;
      return {
        ok: true,
        value: { totpUri: "otpauth://fake", recoveryCodes: ["code-1"] },
        headers: new Headers(),
      };
    },
    verifyCode: sessionStep("verify", "disable-verify=1"),
    activateTotp: sessionStep("activateTotp", "activate-totp=1"),
    disableTotp: sessionStep("disableTotp", "disable-totp=1"),
    revokeOtherSessions: sessionStep("revoke", `${options.operation}-revoke=1`),
  });

  const activate = createActivate({
    writeAudit: async () => {
      ledger.push("audit");
      throwAt("audit");
    },
    observeAuditError: (error) => {
      ledger.push("observeAudit");
      observedAuditErrors.push(error);
    },
  });
  const disable = createDisable({
    spendAttempt: async () => {
      ledger.push("spend");
      return knownFailureAt("spend");
    },
    resetAttempts: async () => {
      ledger.push("reset");
    },
    writeAudit: async () => {
      ledger.push("audit");
      throwAt("audit");
    },
    observeAuditError: (error) => {
      ledger.push("observeAudit");
      observedAuditErrors.push(error);
    },
  });
  const operations: RegistrationOperations = {
    // enroll は本物 (bare export) — replay 分岐の readPending seam を step 粒度で検証できる。
    enroll,
    restart: async () => {
      throw new Error("not used");
    },
    activate,
    disable,
  };
  const app = createRegistrationApplication({
    guard,
    guardedGateway,
    operations,
    notifyEnabled: (email) => {
      ledger.push("notifyEnabled");
      notifications.push(`enabled:${email}`);
    },
    notifyDisabled: (email) => {
      ledger.push("notifyDisabled");
      notifications.push(`disabled:${email}`);
    },
    reportUnknownTransition: (event) => transitionReports.push(event),
  });

  return {
    app,
    faultError,
    ledger,
    notifications,
    observedAuditErrors,
    transitionReports,
    releasedHolds,
    get activeHold() {
      return activeHold;
    },
  };
}
