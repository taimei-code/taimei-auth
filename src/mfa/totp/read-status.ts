import { readMfaStatusRow } from "@/db/repositories/mfa-totp";
import { requiresMfaChallenge } from "../policy";
import type { MfaTotpActor, TotpStatus } from "./contracts";

// 表示もチャレンジ要否と同じ述語を必ず通す (判定二重化の禁止: policy.ts)。
// wire の in_effect ≡ enabled の写像は handler が持つ (ADR-0016)。
export async function readOwnedMfaStatus(actor: MfaTotpActor): Promise<TotpStatus> {
  const row = await readMfaStatusRow(actor.id);
  const enabled = requiresMfaChallenge(row);
  return { enabled, recoveryCodesRemaining: enabled && row ? row.unusedRecoveryCodes : 0 };
}
