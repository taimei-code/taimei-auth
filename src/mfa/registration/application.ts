import type { MfaFailure } from "../error-mapping";
import type { MfaCodeKind } from "../wire-contracts";
import type { EnrollResult, MfaActor, RestartResult } from "./contracts";
import type { GuardedGatewayFactory, RegistrationOperations, TransitionGuard } from "./ports";
import { createTransitionRunner, type ReportUnknownTransition } from "./transition";

type SessionResult = { ok: true; sessionChanges: Headers } | MfaFailure;

export function createRegistrationApplication(deps: {
  guard: TransitionGuard;
  reportUnknownTransition: ReportUnknownTransition;
  guardedGateway: GuardedGatewayFactory;
  operations: RegistrationOperations;
  notifyEnabled(email: string): void;
  notifyDisabled(email: string): void;
}) {
  const runTransition = createTransitionRunner(
    deps.guard,
    deps.reportUnknownTransition,
    deps.guardedGateway,
  );

  const runActivation = async (input: {
    actor: MfaActor;
    headers: Headers;
    enrollmentId?: string;
    code: string;
  }): Promise<SessionResult> => {
    const transitioned = await runTransition(input.actor.id, "activate", (hold, gateway) =>
      deps.operations.activate({ ...input, snapshot: hold.snapshot, gateway }),
    );
    if (!transitioned.ok) return transitioned;
    notifyWithoutChangingResult(() => deps.notifyEnabled(transitioned.notifyEmail));
    return { ok: true, sessionChanges: transitioned.sessionChanges };
  };

  return {
    enroll(input: { actor: MfaActor; headers: Headers }): Promise<EnrollResult> {
      return runTransition(input.actor.id, "enroll", (hold, gateway) =>
        deps.operations.enroll({ ...input, snapshot: hold.snapshot, gateway }),
      );
    },
    restart(input: {
      actor: MfaActor;
      headers: Headers;
      enrollmentId: string;
    }): Promise<RestartResult> {
      return runTransition(input.actor.id, "restart", (hold, gateway) =>
        deps.operations.restart({ ...input, snapshot: hold.snapshot, gateway }),
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
      const transitioned = await runTransition(input.actor.id, "disable", (hold, gateway) =>
        deps.operations.disable({ ...input, snapshot: hold.snapshot, gateway }),
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
