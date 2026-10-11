import { useAtomSet } from "@effect/atom-react";
import { Exit } from "effect";
import { useEffect, useReducer, useRef } from "react";

import {
  mfaChallengeFlowStateOf,
  reduceMfaChallengeFlow,
  type MfaChallengeFlowState,
  type MfaChallengeObservation,
  type MfaChallengeVerification,
} from "./mfa-challenge-flow";
import {
  mfaErrorCodeOfCause,
  verifyMfaChallengeAtom,
  type MfaCodeKind,
  type MfaErrorCode,
} from "./mfa-atom";
import { useMfaCodeInput, type MfaCodeInput } from "./use-mfa-code-entry";

type VerifyExit = Exit.Exit<{ readonly redirect_url: string }, { readonly error: MfaErrorCode }>;

export const verificationOf = (exit: VerifyExit): MfaChallengeVerification<MfaErrorCode> =>
  Exit.match(exit, {
    onSuccess: ({ redirect_url }) => ({ kind: "passed", redirectUrl: redirect_url }),
    onFailure: (cause) => {
      const errorCode = mfaErrorCodeOfCause(cause);
      return errorCode === "challenge_expired"
        ? { kind: "expired" }
        : { kind: "rejected", errorCode };
    },
  });

type MfaChallengeViewKind = "redirecting" | "expired" | "entry";

export type MfaChallengeFlow = {
  view: MfaChallengeViewKind;
  entry: MfaCodeInput;
};

const viewOf = (state: MfaChallengeFlowState<MfaErrorCode>): MfaChallengeViewKind =>
  state.phase === "ready" || state.phase === "verifying" ? "entry" : state.phase;

export function useMfaChallengeFlow(observation: MfaChallengeObservation): MfaChallengeFlow {
  const [state, dispatch] = useReducer(
    reduceMfaChallengeFlow<MfaErrorCode>,
    observation,
    mfaChallengeFlowStateOf<MfaErrorCode>,
  );
  const verify = useAtomSet(verifyMfaChallengeAtom, { mode: "promiseExit" });
  const verificationInFlight = useRef(false);

  const submit = (input: { code: string; kind: MfaCodeKind }) => {
    if (state.phase !== "ready" || verificationInFlight.current) return;

    verificationInFlight.current = true;
    dispatch({ type: "verification_started" });
    void verify({ payload: input })
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
    errorCode: state.phase === "ready" ? state.errorCode : null,
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
