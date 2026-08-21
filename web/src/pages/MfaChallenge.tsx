import { useEffect } from "react";

import { useMfaChallengeFlow } from "@/lib/use-mfa-challenge-flow";
import { useMfaCodeInput } from "@/lib/use-mfa-code-entry";
import { MfaChallengeView } from "./MfaChallengeView";

const CODE_INPUT_ID = "mfa-challenge-code";

// 一次認証 (Magic Link / GitHub OAuth) の後に第二要素を要求する画面。ここへ来た時点で
// セッションは存在せず、認証材料は署名付き cookie が指す MFA チャレンジだけ。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md
export const MfaChallenge = () => {
  const flow = useMfaChallengeFlow();
  const entry = useMfaCodeInput({
    inputId: CODE_INPUT_ID,
    submitting: flow.submitting,
    errorCode: flow.errorCode,
    submit: flow.submit,
    onKindChange: flow.clearError,
  });
  const redirectUrl = flow.state.phase === "redirecting" ? flow.state.redirectUrl : null;

  useEffect(() => {
    if (redirectUrl !== null) {
      // auth ホストの出口検証を正本とする。詳細は ADR-0013 §9。
      window.location.assign(redirectUrl);
    }
  }, [redirectUrl]);

  return <MfaChallengeView state={flow.state} entry={entry} />;
};
