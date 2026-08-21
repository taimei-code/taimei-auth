import { getClientContext } from "../../request-context";
import { ENROLLMENT_CHANGED, failure } from "../error-mapping";
import { mergeForwardedCookies } from "../session-headers";
import type { ActivateDependencies, RegistrationOperations } from "./ports";
import { actorFromSnapshot, enrollmentRecordIn, ensureCanActivate } from "./state";

// ADR-0012 (Use-case 層): 認証アプリの有効化手続。登録済み (未 verified) の two_factor 行を
// 6 桁コードで verified 化し、user.twoFactorEnabled を true にする。

// 副作用の順序を所有する。
//
// 1. 他セッションの revoke を **プラグイン呼び出しより先に** 行う。activateTotp はセッションを
//    rotate する (新 session 作成 → cookie 差し替え → 旧 session 削除) ため、後に回すと
//    revokeOtherSessions が除外する「現在のセッション」が rotate 後の新しいものになり、
//    rotate 前の旧トークンが revoke 対象から外れて生き残る。コード検証より前に revoke が
//    走る帰結は docs/adr/0013-mfa-totp-challenge.md に受容した制約として記録した。
// 2. 返した Headers の Set-Cookie は handler が必ず転送する (gateway.ts invoke の契約)。
// 3. 通知メールは送らず「宛先」だけ Result に載せる。registration applicationがguard解放後に送る。
//
// audit を tx で囲まないのは、この手続で自前 DB に書くのが audit 1 行だけだから
// (フラグと verified の更新は better-auth 側で完結し、同じ tx には入れられない)。
// 既存の at-least-once 近似に倣う。
export function createActivate(deps: ActivateDependencies): RegistrationOperations["activate"] {
  return async ({ actor: requestActor, headers, code, enrollmentId, snapshot }) => {
    const actor = actorFromSnapshot(requestActor, snapshot);

    // 前提条件は revoke より前に置く。後ろに回すと、未登録のまま呼ばれた no-op が
    // 「何も有効化しないまま全デバイスをログアウトさせる」副作用だけを残す。
    // 受理条件の正本は registration/state.ts と ADR-0013 の状態マトリクス。
    const rejected = ensureCanActivate(snapshot);
    if (rejected) return rejected;

    if (enrollmentId !== undefined) {
      const current = enrollmentRecordIn(snapshot);
      if (current?.id !== enrollmentId) return failure(ENROLLMENT_CHANGED);
    }

    const revoked = await deps.revokeOtherSessions(headers);
    if (!revoked.ok) return revoked;

    const activated = await deps.activateTotp(headers, code);
    if (!activated.ok) return activated;

    // 記帳の失敗で手続き全体を落とさない。ここはセッション rotate が済んで巻き戻せない地点で、
    // 例外を投げると handler が Set-Cookie を転送できず、有効化した本人が今のデバイスからログアウトし、
    // 通知メールも送られない (= 有効化されたことに誰も気づけない) 状態になる。失敗は観測へ回す。
    const { ip, userAgent } = getClientContext(headers);
    await deps.writeAudit({ userId: actor.id, ip, userAgent }).catch(deps.observeAuditError);

    return {
      ok: true,
      sessionChanges: mergeForwardedCookies(revoked.headers, activated.headers),
      notifyEmail: actor.email,
    };
  };
}
