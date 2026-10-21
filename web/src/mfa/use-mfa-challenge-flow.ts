import { Exit } from "effect";
import { useEffect, useReducer, useState } from "react";

import {
  mfaChallengeFlowStateOf,
  reduceMfaChallengeFlow,
  type MfaChallengeFlowEvent,
  type MfaChallengeFlowState,
  type MfaChallengeObservation,
  type MfaChallengeVerification,
} from "./mfa-challenge-flow";
import { failureOutcome } from "../shared/failure-message";
import { leaveSpaTo } from "../shared/leave-spa";
import {
  mfaFailureMessage,
  useVerifyMfaChallenge,
  type MfaCodeKind,
  type MfaVerifyFailure,
} from "./mfa-atom";
import { oneAtATime } from "./one-at-a-time";
import { useMfaCodeInput, type MfaCodeInput } from "./use-mfa-code-entry";

type VerifyExit = Exit.Exit<{ readonly redirect_url: string }, MfaVerifyFailure>;

export const verificationOf = (exit: VerifyExit): MfaChallengeVerification =>
  Exit.match(exit, {
    onSuccess: ({ redirect_url }) => ({ kind: "passed", redirectUrl: redirect_url }),
    onFailure: (cause) => {
      const rejected: MfaChallengeVerification = {
        kind: "rejected",
        errorMessage: mfaFailureMessage(cause),
      };
      return failureOutcome<MfaVerifyFailure, MfaChallengeVerification>(
        cause,
        {
          ChallengeExpired: { kind: "expired" },
          InvalidCode: rejected,
          Locked: rejected,
          RateLimited: rejected,
        },
        rejected,
      );
    },
  });

export const submitVerification = (
  input: { code: string; kind: MfaCodeKind },
  deps: {
    verify: (input: { code: string; kind: MfaCodeKind }) => Promise<VerifyExit>;
    dispatch: (event: MfaChallengeFlowEvent) => void;
  },
): Promise<void> => {
  deps.dispatch({ type: "verification_started" });
  return deps
    .verify(input)
    .then((exit) =>
      deps.dispatch({ type: "verification_resolved", verification: verificationOf(exit) }),
    );
};

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
  const [runOneAtATime] = useState(oneAtATime);

  const submit = (input: { code: string; kind: MfaCodeKind }) => {
    if (state.phase !== "ready") return;
    runOneAtATime(() => submitVerification(input, { verify, dispatch }));
  };

  const entry = useMfaCodeInput({
    inputId: "mfa-challenge-code",
    submitting: state.phase === "verifying",
    errorMessage: state.phase === "ready" ? state.errorMessage : null,
    submit,
    onKindChange: () => dispatch({ type: "error_cleared" }),
  });

  const redirectUrl = state.phase === "redirecting" ? state.redirectUrl : null;
  useEffect(() => {
    if (redirectUrl !== null) {
      leaveSpaTo(redirectUrl);
    }
  }, [redirectUrl]);

  return { view: viewOf(state), entry };
}
