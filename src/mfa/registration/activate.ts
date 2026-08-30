import { getClientContext } from "../../request-context";
import { ENROLLMENT_CHANGED, failure } from "../error-mapping";
import { mergeForwardedCookies } from "../session-headers";
import type { ActivateDependencies, RegistrationOperations } from "./ports";
import { actorFromSnapshot, enrollmentRecordIn, ensureCanActivate } from "./state";

// ADR-0012 (Use-case 層): 認証アプリの有効化手続。

// 副作用の順序を所有する。revoke を activateTotp より先に行う — 後にすると rotate 後の新セッションが
// 除外対象になり、rotate 前の旧トークンが revoke から外れて生き残る (受容した帰結: ADR-0013 Consequences)。
// 通知は送らず宛先だけ Result に載せる — 送信は guard 解放後に application が行う (ADR-0013 §8)。
// audit を tx で囲まないのは、この手続で自前 DB に書くのが audit 1 行だけだから。
export function createActivate(deps: ActivateDependencies): RegistrationOperations["activate"] {
  return async ({ actor: requestActor, headers, code, enrollmentId, snapshot, gateway }) => {
    const actor = actorFromSnapshot(requestActor, snapshot);

    // 前提条件は revoke より前に置く。後ろだと、未登録のまま呼ばれた no-op が「何も有効化しないまま
    // 全デバイスをログアウトさせる」副作用だけを残す (受理条件の正本: state.ts / ADR-0013 §7)。
    const rejected = ensureCanActivate(snapshot);
    if (rejected) return rejected;

    if (enrollmentId !== undefined) {
      const current = enrollmentRecordIn(snapshot);
      if (current?.id !== enrollmentId) return failure(ENROLLMENT_CHANGED);
    }

    const revoked = await gateway.revokeOtherSessions(headers);
    if (!revoked.ok) return revoked;

    const activated = await gateway.activateTotp(headers, code);
    if (!activated.ok) return activated;

    // 記帳の失敗で手続き全体を落とさない。ここは rotate 済みで巻き戻せない地点で、例外にすると
    // Set-Cookie が転送されず本人が今のデバイスからログアウトし、通知も送られない。失敗は観測へ回す。
    const { ip, userAgent } = getClientContext(headers);
    await deps.writeAudit({ userId: actor.id, ip, userAgent }).catch(deps.observeAuditError);

    return {
      ok: true,
      sessionChanges: mergeForwardedCookies(revoked.headers, activated.headers),
      notifyEmail: actor.email,
    };
  };
}
