import { useEffect, useReducer, useRef } from "react";
import {
  initialMfaChallengeFlowState,
  reduceMfaChallengeFlow,
  resolveMfaChallengeVerification,
  type MfaChallengeFlowEvent,
  type MfaChallengeFlowState,
  type MfaChallengePort,
} from "./mfa-challenge-flow";
import { mfaChallengePort, type MfaChallengeCodeInput } from "./mfa-challenge-port";
import type { MfaErrorCode } from "./mfa-api";

type ChallengePort = MfaChallengePort<MfaChallengeCodeInput, MfaErrorCode>;

export type MfaChallengeFlow = {
  state: MfaChallengeFlowState<MfaErrorCode>;
  submitting: boolean;
  errorCode: MfaErrorCode | null;
  submit(input: MfaChallengeCodeInput): void;
  clearError(): void;
};

const reducer = (
  state: MfaChallengeFlowState<MfaErrorCode>,
  event: MfaChallengeFlowEvent<MfaErrorCode>,
) => reduceMfaChallengeFlow(state, event);

// port は test 注入用の seam。useEffect の依存のため参照安定な値 (module 定数等) を渡すこと —
// render ごとに新しい object を渡すと観測 GET の abort → 再実行が render のたびに繰り返される。
export function useMfaChallengeFlow(port: ChallengePort = mfaChallengePort): MfaChallengeFlow {
  const [state, dispatch] = useReducer(reducer, initialMfaChallengeFlowState);
  const readController = useRef<AbortController | null>(null);
  const verificationInFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    // 中断対象は初期 GET と再照会だけ。POST 非中断の理由は ADR-0013 §9。
    readController.current = controller;

    void port
      .observe(controller.signal)
      .then((observation) => {
        if (!controller.signal.aborted) {
          dispatch({ type: "observation_resolved", observation });
        }
      })
      // HTTP 変換 port が reject する正常系は cleanup による Abort だけだが、この前提は
      // MfaChallengePort 型に現れない。注入 port が想定外に reject しても observing で固まらず
      // 入力を許す縮退 (AC-003 と同じ unavailable) へ倒す。
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
  }, [port]);

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
    void resolveMfaChallengeVerification(port, input, controller.signal)
      .then((outcome) => {
        if (!controller.signal.aborted) {
          dispatch({ type: "verification_resolved", outcome });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          dispatch({
            type: "verification_resolved",
            outcome: { kind: "rejected", errorCode: "unknown" },
          });
        }
      })
      .finally(() => {
        verificationInFlight.current = false;
      });
  };

  return {
    state,
    submitting: state.phase === "verifying",
    // ready 以外では error を出さない: チャレンジ消滅で expired に移った直後に直前の失敗文言が
    // 残ると、「コードが違う」と「やり直し」が並んで打ち直せば通るように読めるため。
    errorCode: state.phase === "ready" ? state.errorCode : null,
    submit,
    clearError: () => dispatch({ type: "error_cleared" }),
  };
}
