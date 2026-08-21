export type MfaChallengeObservation =
  | { kind: "present" }
  | { kind: "absent" }
  | { kind: "unavailable" };

export type MfaChallengeFlowState<ErrorCode extends string = string> =
  | { phase: "observing" }
  | { phase: "ready"; errorCode: ErrorCode | null }
  | { phase: "verifying" }
  | { phase: "expired" }
  | { phase: "redirecting"; redirectUrl: string };

export type MfaChallengeVerification<ErrorCode extends string> =
  | { kind: "passed"; redirectUrl: string }
  | { kind: "rejected"; errorCode: ErrorCode };

export type MfaChallengePort<Input, ErrorCode extends string> = {
  observe(signal: AbortSignal): Promise<MfaChallengeObservation>;
  verify(input: Input): Promise<MfaChallengeVerification<ErrorCode>>;
};

export type MfaChallengeVerificationOutcome<ErrorCode extends string = string> =
  | { kind: "redirect"; redirectUrl: string }
  | { kind: "expired" }
  | { kind: "rejected"; errorCode: ErrorCode };

export type MfaChallengeFlowEvent<ErrorCode extends string = string> =
  | {
      type: "observation_resolved";
      observation: MfaChallengeObservation;
    }
  | { type: "verification_started" }
  | { type: "verification_resolved"; outcome: MfaChallengeVerificationOutcome<ErrorCode> }
  | { type: "error_cleared" };

export const initialMfaChallengeFlowState = { phase: "observing" } as const;

export async function resolveMfaChallengeVerification<Input, ErrorCode extends string>(
  port: MfaChallengePort<Input, ErrorCode>,
  input: Input,
  signal: AbortSignal,
): Promise<MfaChallengeVerificationOutcome<ErrorCode>> {
  const result = await port.verify(input);
  if (result.kind === "passed") {
    return { kind: "redirect", redirectUrl: result.redirectUrl };
  }
  if (result.errorCode === "challenge_expired") {
    return { kind: "expired" };
  }
  if (result.errorCode === "invalid_code") {
    const observation = await port.observe(signal);
    if (observation.kind === "absent") return { kind: "expired" };
  }
  return { kind: "rejected", errorCode: result.errorCode };
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
    switch (event.outcome.kind) {
      case "redirect":
        return { phase: "redirecting", redirectUrl: event.outcome.redirectUrl };
      case "expired":
        return { phase: "expired" };
      case "rejected":
        return { phase: "ready", errorCode: event.outcome.errorCode };
      default:
        // fall-through すると verifying に固まり画面が操作不能になる。outcome の variant 追加漏れは
        // 実行時でなく typecheck で検出する。
        return event.outcome satisfies never;
    }
  }
  return state;
}
