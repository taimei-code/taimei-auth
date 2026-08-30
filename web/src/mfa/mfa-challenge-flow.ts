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

// port の返す検証結果と flow の解決済み検証結果は同じ union を共有する (改名専用の別型を作らない)。
export type MfaChallengeVerification<ErrorCode extends string> =
  | { kind: "passed"; redirectUrl: string }
  | { kind: "expired" }
  | { kind: "rejected"; errorCode: ErrorCode };

export type MfaChallengePort<Input, ErrorCode extends string> = {
  observe(signal: AbortSignal): Promise<MfaChallengeObservation>;
  // expired の終端判断は resolveMfaChallengeVerification が所有する。Exclude で port が返せる形から
  // 外し、「port が expired を宣言して flow の判断を迂回する」実装を型で塞ぐ。
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
        // fall-through は verifying に固まり操作不能になる。variant 追加漏れは typecheck で検出する。
        return event.verification satisfies never;
    }
  }
  return state;
}
