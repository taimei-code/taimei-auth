import type { MfaFailure } from "../error-mapping";
import type { MfaCodeKind } from "../wire-contracts";
import type { EnrollResult, RegistrationPrincipal, RestartResult } from "./contracts";
import type { RegistrationOperations, TransitionGuard } from "./ports";
import type { MfaStatus } from "./status";
import {
  createTransitionRunner,
  type ReportUnknownTransition,
  type TransitionBusy,
} from "./transition";

type SessionResult = { ok: true; sessionChanges: Headers } | MfaFailure;

export function createRegistrationApplication(deps: {
  guard: TransitionGuard;
  reportUnknownTransition?: ReportUnknownTransition;
  operations: RegistrationOperations;
  notifyEnabled(email: string): void;
  notifyDisabled(email: string): void;
}) {
  const runTransition = createTransitionRunner(deps.guard, deps.reportUnknownTransition);

  const runActivation = async (input: {
    principal: RegistrationPrincipal;
    headers: Headers;
    enrollmentId?: string;
    code: string;
  }): Promise<SessionResult | TransitionBusy> => {
    const transitioned = await runTransition(input.principal.userId, "activate", (snapshot) =>
      deps.operations.activate({ ...input, snapshot }),
    );
    if (!transitioned.ok) return transitioned;
    notifyWithoutChangingResult(() => deps.notifyEnabled(transitioned.notifyEmail));
    return { ok: true, sessionChanges: transitioned.sessionChanges };
  };

  return {
    getStatus(principal: RegistrationPrincipal): Promise<MfaStatus> {
      return deps.operations.getStatus(principal);
    },
    enroll(input: {
      principal: RegistrationPrincipal;
      headers: Headers;
    }): Promise<EnrollResult | TransitionBusy> {
      return runTransition(input.principal.userId, "enroll", (snapshot) =>
        deps.operations.enroll({ ...input, snapshot }),
      );
    },
    restart(input: {
      principal: RegistrationPrincipal;
      headers: Headers;
      enrollmentId: string;
    }): Promise<RestartResult | TransitionBusy> {
      return runTransition(input.principal.userId, "restart", (snapshot) =>
        deps.operations.restart({ ...input, snapshot }),
      );
    },
    activate(input: {
      principal: RegistrationPrincipal;
      headers: Headers;
      enrollmentId: string;
      code: string;
    }): Promise<SessionResult | TransitionBusy> {
      return runActivation(input);
    },
    activateLegacy(input: {
      principal: RegistrationPrincipal;
      headers: Headers;
      code: string;
    }): Promise<SessionResult | TransitionBusy> {
      return runActivation(input);
    },
    async disable(input: {
      principal: RegistrationPrincipal;
      headers: Headers;
      code: string;
      kind: MfaCodeKind;
    }): Promise<SessionResult | TransitionBusy> {
      const transitioned = await runTransition(input.principal.userId, "disable", (snapshot) =>
        deps.operations.disable({ ...input, snapshot }),
      );
      if (!transitioned.ok) return transitioned;
      notifyWithoutChangingResult(() => deps.notifyDisabled(transitioned.notifyEmail));
      return { ok: true, sessionChanges: transitioned.sessionChanges };
    },
  };
}

function notifyWithoutChangingResult(notify: () => void): void {
  try {
    notify();
  } catch (error) {
    console.error("failed to schedule MFA notification", error);
  }
}
