import { useEffect, useReducer, useRef } from "react";
import {
  initialMfaChallengeFlowState,
  reduceMfaChallengeFlow,
  resolveMfaChallengeVerification,
  type MfaChallengeFlowState,
  type MfaChallengePort,
} from "./mfa-challenge-flow";
import { getMfaChallenge, mfaErrorCodeOf, verifyMfaChallenge, type MfaErrorCode } from "./mfa-api";
import { useMfaCodeInput, type MfaCodeInput } from "./use-mfa-code-entry";

// verify API の入力型に直接繋ぐ — 別に書き下すと field が増えた時に黙って drift する。
type MfaChallengeCodeInput = Parameters<typeof verifyMfaChallenge>[0];

type ChallengePort = MfaChallengePort<MfaChallengeCodeInput, MfaErrorCode>;

// HTTP 応答・例外を flow 向けの観測結果 / 検証結果へ変換する唯一の production port (ADR-0013 §9)。
// wire 形の検査は mfa-api の positive check が所有し、ここは HTTP の成否を flow の語彙へ写すだけ。
export const mfaChallengePort: ChallengePort = {
  observe: async (signal) => {
    try {
      const { pending } = await getMfaChallenge(signal);
      return pending ? { kind: "present" } : { kind: "absent" };
    } catch (error) {
      if (signal.aborted) throw error;
      // 形の崩れた 2xx も通信失敗と同じく不存在を推測せず入力を許す (ADR-0013 §9)。
      return { kind: "unavailable" };
    }
  },
  // POST 側には意図的に AbortSignal を渡さない。理由は ADR-0013 §9。
  verify: async (input) => {
    try {
      const { redirectUrl } = await verifyMfaChallenge(input);
      return { kind: "passed", redirectUrl };
    } catch (error) {
      return { kind: "rejected", errorCode: mfaErrorCodeOf(error) };
    }
  },
};

// 画面が受け取る表示区分。observing / redirecting は sr-only 文言が違うため区別を保ち、
// ready / verifying の差は entry.submitting が吸収するので entry に畳む。
type MfaChallengeViewKind = "observing" | "redirecting" | "expired" | "entry";

export type MfaChallengeFlow = {
  view: MfaChallengeViewKind;
  entry: MfaCodeInput;
};

// ready / verifying 以外の phase 名は表示区分と一致するのでそのまま流用する。
const viewOf = (state: MfaChallengeFlowState<MfaErrorCode>): MfaChallengeViewKind =>
  state.phase === "ready" || state.phase === "verifying" ? "entry" : state.phase;

// port は test 注入用の seam。useEffect の依存のため参照安定な値を渡すこと — render ごとに新しい
// object を渡すと観測 GET の abort → 再実行が render のたびに繰り返される。
export function useMfaChallengeFlow(port: ChallengePort = mfaChallengePort): MfaChallengeFlow {
  const [state, dispatch] = useReducer(
    reduceMfaChallengeFlow<MfaErrorCode>,
    initialMfaChallengeFlowState,
  );
  const readController = useRef<AbortController | null>(null);
  const verificationInFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    // 中断対象は初期 GET と再照会だけ (ADR-0013 §9)。
    readController.current = controller;

    void port
      .observe(controller.signal)
      .then((observation) => {
        if (!controller.signal.aborted) {
          dispatch({ type: "observation_resolved", observation });
        }
      })
      // port が reject する正常系は cleanup の Abort だけだが、その前提は型に現れない。想定外の
      // reject でも observing で固まらせず、入力を許す縮退 (AC-003 と同じ unavailable) へ倒す。
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
      .then((verification) => {
        if (!controller.signal.aborted) {
          dispatch({ type: "verification_resolved", verification });
        }
      })
      // 縮退は "unknown" 固定にする — reject 経路の error を code へ写すと、terminal な
      // challenge_expired でも ready (入力可能) に載り、打ち直せない文言と生きた入力欄が並ぶ。
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
    // ready 以外では error を出さない: expired へ移った直後に直前の失敗文言が残ると、
    // 「コードが違う」と「やり直し」が並んで打ち直せば通るように読めるため。
    errorCode: state.phase === "ready" ? state.errorCode : null,
    submit,
    onKindChange: () => dispatch({ type: "error_cleared" }),
  });

  const redirectUrl = state.phase === "redirecting" ? state.redirectUrl : null;
  useEffect(() => {
    if (redirectUrl !== null) {
      // auth ホストの出口検証を正本とする。詳細は ADR-0013 §9。
      window.location.assign(redirectUrl);
    }
  }, [redirectUrl]);

  return { view: viewOf(state), entry };
}
