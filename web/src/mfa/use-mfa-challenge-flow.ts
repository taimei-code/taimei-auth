import { Exit } from "effect";
import { useEffect, useReducer, useRef } from "react";

import {
  mfaChallengeFlowStateOf,
  reduceMfaChallengeFlow,
  type MfaChallengeFlowState,
  type MfaChallengeObservation,
  type MfaChallengeVerification,
} from "./mfa-challenge-flow";
import { hasFailureTag } from "../shared/failure-message";
import {
  mfaFailureMessage,
  useVerifyMfaChallenge,
  type MfaCodeKind,
  type MfaFailure,
} from "./mfa-atom";
import { useMfaCodeInput, type MfaCodeInput } from "./use-mfa-code-entry";

type VerifyExit = Exit.Exit<{ readonly redirect_url: string }, MfaFailure>;

export const verificationOf = (exit: VerifyExit): MfaChallengeVerification =>
  Exit.match(exit, {
    onSuccess: ({ redirect_url }) => ({ kind: "passed", redirectUrl: redirect_url }),
    onFailure: (cause) =>
      hasFailureTag(cause, "ChallengeExpired")
        ? { kind: "expired" }
        : { kind: "rejected", errorMessage: mfaFailureMessage(cause) },
  });

type MfaChallengeViewKind = "redirecting" | "expired" | "entry";

export type MfaChallengeFlow = {
  view: MfaChallengeViewKind;
  entry: MfaCodeInput;
};

const viewOf = (state: MfaChallengeFlowState): MfaChallengeViewKind =>
  state.phase === "ready" || state.phase === "verifying" ? "entry" : state.phase;

export function useMfaChallengeFlow(observation: MfaChallengeObservation): MfaChallengeFlow {
  const [state, dispatch] = useReducer(
    reduceMfaChallengeFlow,
    observation,
    mfaChallengeFlowStateOf,
  );
  const verify = useVerifyMfaChallenge();
  const verificationInFlight = useRef(false);

  const submit = (input: { code: string; kind: MfaCodeKind }) => {
    if (state.phase !== "ready" || verificationInFlight.current) return;

    verificationInFlight.current = true;
    dispatch({ type: "verification_started" });
    void verify(input)
      .then((exit) =>
        dispatch({ type: "verification_resolved", verification: verificationOf(exit) }),
      )
      .finally(() => {
        verificationInFlight.current = false;
      });
  };

  const entry = useMfaCodeInput({
    inputId: "mfa-challenge-code",
    submitting: state.phase === "verifying",
    // expired では直前の失敗文言を出さない (打ち直せば通るように読める)
    errorMessage: state.phase === "ready" ? state.errorMessage : null,
    submit,
    onKindChange: () => dispatch({ type: "error_cleared" }),
  });

  // 画面を離れた後の遅い成功で遷移しないよう、遷移は描画中の state からだけ起こす
  const redirectUrl = state.phase === "redirecting" ? state.redirectUrl : null;
  useEffect(() => {
    if (redirectUrl !== null) {
      window.location.assign(redirectUrl);
    }
  }, [redirectUrl]);

  return { view: viewOf(state), entry };
}
