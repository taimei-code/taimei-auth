import {
  deleteMfaTotp,
  deleteRecoveryCodesByUserId,
  readMfaVerification,
} from "@/db/repositories/mfa-totp";
import { runInTransaction } from "@/db/transaction";
import { getClientContext } from "../../request-context";
import { failure, NOT_ENABLED } from "../error-mapping";
import type { MfaCodeKind } from "../wire-contracts";
import type { MfaTotpActor, TotpSessionResult } from "./contracts";
import type { DisableMfaDependencies } from "./ports";
import { verifyAndConsumeOwnedCode } from "./verify-code";

// 無効化 (正しいコードによる本人確認つき)。1 tx で行 + コード全削除 — 途中で死んでも 3 状態の
// いずれかに留まり再実行で収束する。試行 budget は総当たり防御 (disable-attempt-budget)。

export function createMfaDisable(deps: DisableMfaDependencies) {
  return async function disable(input: {
    actor: MfaTotpActor;
    headers: Headers;
    code: string;
    kind: MfaCodeKind;
  }): Promise<TotpSessionResult> {
    // 未登録に budget を消費させない前段判定は最小射影で足りる (secret 込みの行は kernel が読む)。
    const enrollment = await readMfaVerification(input.actor.id);
    if (!enrollment || enrollment.verifiedAt === null) return failure(NOT_ENABLED);

    const spent = await deps.spendAttempt(input.actor.id);
    if (spent) return spent;

    const rejected = await verifyAndConsumeOwnedCode(deps.ring(), input.actor.id, {
      code: input.code,
      kind: input.kind,
    });
    if (rejected) return rejected;
    await deps.resetAttempts(input.actor.id);

    const revoked = await deps.sessions.revokeOthers(input.headers);
    if (!revoked.ok) return revoked;

    await runInTransaction(async (tx) => {
      await deleteMfaTotp(input.actor.id, tx);
      await deleteRecoveryCodesByUserId(input.actor.id, tx);
    });

    const { ip, userAgent } = getClientContext(input.headers);
    await deps.writeAudit({ userId: input.actor.id, ip, userAgent }).catch(deps.observeAuditError);
    deps.notifyDisabled(input.actor.email);
    return { ok: true, sessionChanges: revoked.headers };
  };
}
