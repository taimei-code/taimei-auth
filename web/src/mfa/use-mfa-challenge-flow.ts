import { useEffect, useReducer, useRef } from "react";
import {
  initialMfaChallengeFlowState,
  reduceMfaChallengeFlow,
  type MfaChallengeFlowState,
  type MfaChallengeObservation,
  type MfaChallengeVerification,
} from "./mfa-challenge-flow";
import { getMfaChallenge, mfaErrorCodeOf, verifyMfaChallenge, type MfaErrorCode } from "./mfa-api";
import { useMfaCodeInput, type MfaCodeInput } from "./use-mfa-code-entry";

type MfaChallengeCodeInput = Parameters<typeof verifyMfaChallenge>[0];

export const mfaChallengePort = {
  readChallengeState: async (signal: AbortSignal): Promise<MfaChallengeObservation> => {
    try {
      const { pending } = await getMfaChallenge(signal);
      return pending ? { kind: "present" } : { kind: "absent" };
    } catch (error) {
      if (signal.aborted) throw error;
      // 通信失敗も崩れた 2xx も absent とは推測せず、入力を許す
      return { kind: "unavailable" };
    }
  },
  verify: async (input: MfaChallengeCodeInput): Promise<MfaChallengeVerification<MfaErrorCode>> => {
    try {
      const { redirectUrl } = await verifyMfaChallenge(input);
      return { kind: "passed", redirectUrl };
    } catch (error) {
      const errorCode = mfaErrorCodeOf(error);
      return errorCode === "challenge_expired"
        ? { kind: "expired" }
        : { kind: "rejected", errorCode };
    }
  },
};

type MfaChallengeViewKind = "observing" | "redirecting" | "expired" | "entry";

export type MfaChallengeFlow = {
  view: MfaChallengeViewKind;
  entry: MfaCodeInput;
};

const viewOf = (state: MfaChallengeFlowState<MfaErrorCode>): MfaChallengeViewKind =>
  state.phase === "ready" || state.phase === "verifying" ? "entry" : state.phase;

export function useMfaChallengeFlow(): MfaChallengeFlow {
  const [state, dispatch] = useReducer(
    reduceMfaChallengeFlow<MfaErrorCode>,
    initialMfaChallengeFlowState,
  );
  const readController = useRef<AbortController | null>(null);
  const verificationInFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    readController.current = controller;

    void mfaChallengePort
      .readChallengeState(controller.signal)
      .then((observation) => {
        if (!controller.signal.aborted) {
          dispatch({ type: "observation_resolved", observation });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          dispatch({
            type: "observation_resolved",
            observation: { kind: "unavailable" },
          });
        }
      });

    return () => {
      controller.abort();
      readController.current = null;
    };
  }, []);

  const submit = (input: MfaChallengeCodeInput) => {
    const controller = readController.current;
    if (
      state.phase !== "ready" ||
      verificationInFlight.current ||
      !controller ||
      controller.signal.aborted
    ) {
      return;
    }

    verificationInFlight.current = true;
    dispatch({ type: "verification_started" });
    void mfaChallengePort
      .verify(input)
      .then((verification) => {
        if (!controller.signal.aborted) {
          dispatch({ type: "verification_resolved", verification });
        }
      })
      // "unknown" 固定。終端の challenge_expired を ready に入れると有効な入力欄と並ぶ
      .catch(() => {
        if (!controller.signal.aborted) {
          dispatch({
            type: "verification_resolved",
            verification: { kind: "rejected", errorCode: "unknown" },
          });
        }
      })
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

  const redirectUrl = state.phase === "redirecting" ? state.redirectUrl : null;
  useEffect(() => {
    if (redirectUrl !== null) {
      window.location.assign(redirectUrl);
    }
  }, [redirectUrl]);

  return { view: viewOf(state), entry };
}
