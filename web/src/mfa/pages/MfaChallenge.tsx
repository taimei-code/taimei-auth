import { MfaChallengeView } from "../MfaChallengeView";
import { useMfaChallengeFlow } from "../use-mfa-challenge-flow";

// 一次認証の後に第二要素を要求する画面。ここへ来た時点でセッションは存在せず、認証材料は
// 署名付き cookie が指す MFA チャレンジだけ。設計詳細: docs/adr/0013-mfa-totp-challenge.md
export const MfaChallenge = () => <MfaChallengeView {...useMfaChallengeFlow()} />;
