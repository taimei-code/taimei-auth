import { getClientContext } from "../../request-context";
import { mergeForwardedCookies } from "../session-headers";
import type { DisableDependencies, RegistrationOperations } from "./ports";
import { actorFromSnapshot, ensureDisableCanProceed } from "./state";

// ADR-0012 (Use-case 層): 認証アプリの無効化手続。
// 受理条件 (中断状態からの出口を含む) の正本: state.ts / ADR-0013 §7 の状態マトリクス。

// 本人確認を先頭に置き、**コードが誤っていれば副作用を 1 つも起こさない**。パスワードを持たない構成では
// 現在の TOTP / リカバリーコードだけが「本人が第二要素を今も持っている」証拠で、後段に回すと誤コードでも
// revoke と rotate が起きる。誤コード連投の抑止も自前持ち (disable-attempt-budget.ts)。
export function createDisable(deps: DisableDependencies): RegistrationOperations["disable"] {
  return async ({ actor: requestActor, headers, code, kind, snapshot, gateway }) => {
    const actor = actorFromSnapshot(requestActor, snapshot);

    // 前提条件をコード検証・試行枠消費より前に置く。未有効化のまま verifyTOTP を呼ぶと要求と正反対の
    // 有効化が成立し、永久に成功しない状態で枠を空費すると正しいコードでもロックに達する。
    const rejected = ensureDisableCanProceed(snapshot);
    if (rejected) return rejected;

    // 枠を消費してから検証する。確かめてから数える順だと、同時到着した全員が「まだ 0 回」を読んで素通りする。
    const exhausted = await deps.spendAttempt(actor.id);
    if (exhausted) return exhausted;

    const verified = await gateway.verifyCode(headers, { code, kind });
    if (!verified.ok) return verified;
    await deps.resetAttempts(actor.id);

    const revoked = await gateway.revokeOtherSessions(headers);
    if (!revoked.ok) return revoked;

    const disabled = await gateway.disableTotp(headers);
    if (!disabled.ok) return disabled;

    // 記帳の失敗で手続き全体を落とさない (rotate 済みで巻き戻せない地点。理由: activate.ts)。
    const { ip, userAgent } = getClientContext(headers);
    await deps.writeAudit({ userId: actor.id, ip, userAgent }).catch(deps.observeAuditError);

    return {
      ok: true,
      sessionChanges: mergeForwardedCookies(verified.headers, revoked.headers, disabled.headers),
      notifyEmail: actor.email,
    };
  };
}
