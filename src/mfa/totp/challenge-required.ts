import { readMfaVerification } from "@/db/repositories/mfa-totp";
import { requiresMfaChallenge } from "../policy";

// ログイン境界の +1 SELECT の唯一の読み口 (D5)。PK 引き 1 行・secret 列に触れない射影に限る。
// 発火点は一次認証成功後の after-hook のみで、リクエスト毎ではない。
export async function readMfaChallengeRequired(userId: string): Promise<boolean> {
  return requiresMfaChallenge(await readMfaVerification(userId));
}
