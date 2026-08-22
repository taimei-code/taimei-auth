import { useMfaChallengeFlow } from "@/lib/use-mfa-challenge-flow";
import { MfaChallengeView } from "./MfaChallengeView";

// 一次認証 (Magic Link / GitHub OAuth) の後に第二要素を要求する画面。ここへ来た時点で
// セッションは存在せず、認証材料は署名付き cookie が指す MFA チャレンジだけ。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md
export const MfaChallenge = () => <MfaChallengeView {...useMfaChallengeFlow()} />;
