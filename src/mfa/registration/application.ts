import type { MfaFailure } from "../error-mapping";
import type { MfaCodeKind } from "../wire-contracts";
import type { EnrollResult, MfaActor, RestartResult } from "./contracts";
import type { RegistrationOperations, TransitionGuard } from "./ports";
import { createTransitionRunner, type ReportUnknownTransition } from "./transition";

type SessionResult = { ok: true; sessionChanges: Headers } | MfaFailure;

export function createRegistrationApplication(deps: {
  guard: TransitionGuard;
  reportUnknownTransition: ReportUnknownTransition;
  operations: RegistrationOperations;
  notifyEnabled(email: string): void;
  notifyDisabled(email: string): void;
}) {
  const runTransition = createTransitionRunner(deps.guard, deps.reportUnknownTransition);

  const runActivation = async (input: {
    actor: MfaActor;
    headers: Headers;
    enrollmentId?: string;
    code: string;
  }): Promise<SessionResult> => {
    const transitioned = await runTransition(input.actor.id, "activate", (snapshot) =>
      deps.operations.activate({ ...input, snapshot }),
    );
    if (!transitioned.ok) return transitioned;
    notifyWithoutChangingResult(() => deps.notifyEnabled(transitioned.notifyEmail));
    return { ok: true, sessionChanges: transitioned.sessionChanges };
  };

  return {
    enroll(input: { actor: MfaActor; headers: Headers }): Promise<EnrollResult> {
      return runTransition(input.actor.id, "enroll", (snapshot) =>
        deps.operations.enroll({ ...input, snapshot }),
      );
    },
    restart(input: {
      actor: MfaActor;
      headers: Headers;
      enrollmentId: string;
    }): Promise<RestartResult> {
      return runTransition(input.actor.id, "restart", (snapshot) =>
        deps.operations.restart({ ...input, snapshot }),
      );
    },
    activate(input: {
      actor: MfaActor;
      headers: Headers;
      enrollmentId: string;
      code: string;
    }): Promise<SessionResult> {
      return runActivation(input);
    },
    activateLegacy(input: {
      actor: MfaActor;
      headers: Headers;
      code: string;
    }): Promise<SessionResult> {
      return runActivation(input);
    },
    async disable(input: {
      actor: MfaActor;
      headers: Headers;
      code: string;
      kind: MfaCodeKind;
    }): Promise<SessionResult> {
      const transitioned = await runTransition(input.actor.id, "disable", (snapshot) =>
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
