import { activateMfaTotp, findMfaTotp } from "@/db/repositories/mfa-totp";
import { getClientContext } from "../../request-context";
import {
  ALREADY_ENABLED,
  ENROLLMENT_CHANGED,
  failure,
  INVALID_CODE,
  NOT_FOUND,
} from "../error-mapping";
import type { MfaTotpActor, TotpSessionResult } from "./contracts";
import { decryptValue, secretCipher } from "./cipher";
import type { ActivateMfaDependencies } from "./ports";
import { matchTotpCode } from "./totp-engine";

// 有効化。検証順序が契約 (§4.3): 復号 + コード検証 → revoke → 確定 UPDATE。
// 誤コードは revoke より前で終わり他デバイスを失効させない。revoke を確定より先に置くのは、
// 逆順で revoke が失敗すると「有効化済みなのに他 session が残る」窓が開くため。session rotate は行わない。

export function createMfaActivation(deps: ActivateMfaDependencies) {
  return async function activate(input: {
    actor: MfaTotpActor;
    headers: Headers;
    enrollmentId: string;
    code: string;
  }): Promise<TotpSessionResult> {
    const row = await findMfaTotp(input.actor.id);
    if (!row) return failure(NOT_FOUND);
    if (row.verifiedAt !== null) return failure(ALREADY_ENABLED);
    if (input.enrollmentId !== row.enrollmentId) return failure(ENROLLMENT_CHANGED);

    const secret = await decryptValue(deps.ring(), secretCipher(row), input.actor.id);
    const timestep = matchTotpCode(secret, input.code);
    if (timestep === null) return failure(INVALID_CODE);

    const revoked = await deps.sessions.revokeOthers(input.headers);
    if (!revoked.ok) return revoked;

    // false = 並行敗者 (勝者が verified 化済み)。識別子はここで再照合されるため評決は already_enabled。
    if (!(await activateMfaTotp(input.actor.id, row.enrollmentId, timestep))) {
      return failure(ALREADY_ENABLED);
    }

    const { ip, userAgent } = getClientContext(input.headers);
    await deps.writeAudit({ userId: input.actor.id, ip, userAgent }).catch(deps.observeAuditError);
    deps.notifyEnabled(input.actor.email);
    return { ok: true, sessionChanges: revoked.headers };
  };
}
