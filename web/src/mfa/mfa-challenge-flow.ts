export type MfaChallengeObservation =
  | { kind: "present" }
  | { kind: "absent" }
  | { kind: "unavailable" };

export type MfaChallengeFlowState<ErrorCode extends string> =
  | { phase: "observing" }
  | { phase: "ready"; errorCode: ErrorCode | null }
  | { phase: "verifying" }
  | { phase: "expired" }
  | { phase: "redirecting"; redirectUrl: string };

export type MfaChallengeVerification<ErrorCode extends string> =
  | { kind: "passed"; redirectUrl: string }
  | { kind: "expired" }
  | { kind: "rejected"; errorCode: ErrorCode };

export type MfaChallengePort<Input, ErrorCode extends string> = {
  observe(signal: AbortSignal): Promise<MfaChallengeObservation>;
  // expired を終端と判断するのは resolveMfaChallengeVerification なので、port からは Exclude で外す。
  verify(input: Input): Promise<Exclude<MfaChallengeVerification<ErrorCode>, { kind: "expired" }>>;
};

export type MfaChallengeFlowEvent<ErrorCode extends string> =
  | {
      type: "observation_resolved";
      observation: MfaChallengeObservation;
    }
  | { type: "verification_started" }
  | { type: "verification_resolved"; verification: MfaChallengeVerification<ErrorCode> }
  | { type: "error_cleared" };

export const initialMfaChallengeFlowState = { phase: "observing" } as const;

export async function resolveMfaChallengeVerification<Input, ErrorCode extends string>(
  port: MfaChallengePort<Input, ErrorCode>,
  input: Input,
  signal: AbortSignal,
): Promise<MfaChallengeVerification<ErrorCode>> {
  const result = await port.verify(input);
  if (result.kind === "passed") {
    return result;
  }
  if (result.errorCode === "challenge_expired") {
    return { kind: "expired" };
  }
  if (result.errorCode === "invalid_code") {
    const observation = await port.observe(signal);
    if (observation.kind === "absent") return { kind: "expired" };
  }
  return result;
}

export function reduceMfaChallengeFlow<ErrorCode extends string>(
  state: MfaChallengeFlowState<ErrorCode>,
  event: MfaChallengeFlowEvent<ErrorCode>,
): MfaChallengeFlowState<ErrorCode> {
  if (state.phase === "observing" && event.type === "observation_resolved") {
    return event.observation.kind === "absent"
      ? { phase: "expired" }
      : { phase: "ready", errorCode: null };
  }
  if (state.phase === "ready" && event.type === "verification_started") {
    return { phase: "verifying" };
  }
  if (state.phase === "ready" && event.type === "error_cleared") {
    return { phase: "ready", errorCode: null };
  }
  if (state.phase === "verifying" && event.type === "verification_resolved") {
    switch (event.verification.kind) {
      case "passed":
        return { phase: "redirecting", redirectUrl: event.verification.redirectUrl };
      case "expired":
        return { phase: "expired" };
      case "rejected":
        return { phase: "ready", errorCode: event.verification.errorCode };
      default:
        return event.verification satisfies never;
    }
  }
  return state;
}
