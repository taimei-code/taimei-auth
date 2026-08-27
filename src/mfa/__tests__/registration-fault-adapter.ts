import { createActivate } from "../registration/activate";
import { createRegistrationApplication } from "../registration/application";
import { createDisable } from "../registration/disable";
import { CHALLENGE_EXPIRED, failure, LOCKED, type MfaFailure } from "../error-mapping";
import type {
  GuardHold,
  RegistrationOperations,
  RegistrationSnapshot,
  TransitionGuard,
} from "../registration/ports";
import type { ReportUnknownTransition } from "../registration/transition";

type ThrowFaultStep = "verify" | "revoke" | "activateTotp" | "disableTotp" | "audit";

export type RegistrationFault =
  | { step: "spend"; mode: "known" }
  | {
      step: Exclude<ThrowFaultStep, "audit">;
      mode: "known" | "throw";
    }
  | { step: "audit"; mode: "throw" };

const acceptedSnapshotsByOperation: Record<"activate" | "disable", RegistrationSnapshot> = {
  activate: {
    user: "present",
    email: "snapshot@example.com",
    twoFactorEnabled: false,
    enrollment: { id: "enrollment-1", verified: false },
  },
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
  operation: "activate" | "disable";
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
      activeHold = {
        userId,
        token: `guard-${operation}`,
        operation,
        snapshot: options.snapshot ?? acceptedSnapshotsByOperation[operation],
      };
      return { acquired: true, hold: activeHold };
    },
    release: async (hold) => {
      ledger.push("release");
      releasedHolds.push(hold);
      activeHold = undefined;
      return { released: true };
    },
  };

  const activate = createActivate({
    revokeOtherSessions: async () => {
      ledger.push("revoke");
      const known = knownFailureAt("revoke");
      if (known) return known;
      throwAt("revoke");
      return successfulSessionMutation("activate-revoke=1");
    },
    activateTotp: async () => {
      ledger.push("activateTotp");
      const known = knownFailureAt("activateTotp");
      if (known) return known;
      throwAt("activateTotp");
      return successfulSessionMutation("activate-totp=1");
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
  const disable = createDisable({
    spendAttempt: async () => {
      ledger.push("spend");
      return knownFailureAt("spend");
    },
    verifyCode: async () => {
      ledger.push("verify");
      const known = knownFailureAt("verify");
      if (known) return known;
      throwAt("verify");
      return successfulSessionMutation("disable-verify=1");
    },
    resetAttempts: async () => {
      ledger.push("reset");
    },
    revokeOtherSessions: async () => {
      ledger.push("revoke");
      const known = knownFailureAt("revoke");
      if (known) return known;
      throwAt("revoke");
      return successfulSessionMutation("disable-revoke=1");
    },
    disableTotp: async () => {
      ledger.push("disableTotp");
      const known = knownFailureAt("disableTotp");
      if (known) return known;
      throwAt("disableTotp");
      return successfulSessionMutation("disable-totp=1");
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
    enroll: async () => {
      throw new Error("not used");
    },
    restart: async () => {
      throw new Error("not used");
    },
    activate,
    disable,
  };
  const app = createRegistrationApplication({
    guard,
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
