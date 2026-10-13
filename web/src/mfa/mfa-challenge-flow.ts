export type MfaChallengeObservation =
  | { kind: "present" }
  | { kind: "absent" }
  | { kind: "unavailable" };

export type MfaChallengeFlowState =
  | { phase: "ready"; errorMessage: string | null }
  | { phase: "verifying" }
  | { phase: "expired" }
  | { phase: "redirecting"; redirectUrl: string };

export type MfaChallengeVerification =
  | { kind: "passed"; redirectUrl: string }
  | { kind: "expired" }
  | { kind: "rejected"; errorMessage: string };

export type MfaChallengeFlowEvent =
  | { type: "verification_started" }
  | { type: "verification_resolved"; verification: MfaChallengeVerification }
  | { type: "error_cleared" };

export const mfaChallengeFlowStateOf = (
  observation: MfaChallengeObservation,
): MfaChallengeFlowState =>
  observation.kind === "absent" ? { phase: "expired" } : { phase: "ready", errorMessage: null };

export function reduceMfaChallengeFlow(
  state: MfaChallengeFlowState,
  event: MfaChallengeFlowEvent,
): MfaChallengeFlowState {
  if (state.phase === "ready" && event.type === "verification_started") {
    return { phase: "verifying" };
  }
  if (state.phase === "ready" && event.type === "error_cleared") {
    return { phase: "ready", errorMessage: null };
  }
  if (state.phase === "verifying" && event.type === "verification_resolved") {
    switch (event.verification.kind) {
      case "passed":
        return { phase: "redirecting", redirectUrl: event.verification.redirectUrl };
      case "expired":
        return { phase: "expired" };
      case "rejected":
        return { phase: "ready", errorMessage: event.verification.errorMessage };
      default:
        return event.verification satisfies never;
    }
  }
  return state;
}
