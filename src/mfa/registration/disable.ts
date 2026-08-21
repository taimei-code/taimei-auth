import { getClientContext } from "../../request-context";
import { mergeForwardedCookies } from "../session-headers";
import type { DisableDependencies, RegistrationOperations } from "./ports";
import { actorFromSnapshot, ensureDisableCanProceed } from "./state";

// ADR-0012 (Use-case 層): 認証アプリの無効化手続。two_factor 行を削除し
// user.twoFactorEnabled を false に戻す。受理条件 (中断状態からの出口を含む) の正本は
// registration/state.ts / docs/adr/0013-mfa-totp-challenge.md の状態マトリクス。

// 本人確認を先頭に置き、**コードが誤っていれば副作用を 1 つも起こさない**。パスワードを持たない
// 構成では現在の TOTP コードかリカバリーコードだけが「本人が第二要素を今も持っている」証拠で、
// これを後段に回すと誤コードでも他セッションの revoke やセッション rotate が起きてしまう。
// 成功後の順序は activate と同じ (revoke → rotate → audit → 宛先を Result で返す)。
//
// **セッションあり経路にはプラグインの試行制限が一切継承されない** (挙動: gateway.ts の
// verifyMfaCode、判断の詳細: ADR-0013)。誤コード連投の抑止はこの use-case が自前で持つ
// (disable-attempt-budget.ts)。
export function createDisable(deps: DisableDependencies): RegistrationOperations["disable"] {
  return async ({ actor: requestActor, headers, code, kind, snapshot }) => {
    const actor = actorFromSnapshot(requestActor, snapshot);

    // 前提条件をコード検証・試行枠消費より前に置く。verifyTOTP は未有効化状態を有効化の合図として
    // 扱う (gateway.ts の activateTotp) ため未有効化のまま呼ぶと要求と正反対の有効化が成立し、
    // かつ「検証しても永久に成功しない状態」で枠を空費すると正しいコードでもロックに達する
    // (どちらも ensureDisableCanProceed が弾く)。
    const rejected = ensureDisableCanProceed(snapshot);
    if (rejected) return rejected;

    // コード検証は 1 回ぶんの枠を消費してから通す。枠を確かめてから数える順にすると、同時に
    // 撃ち込まれた複数リクエストが全員「まだ 0 回」を読んで上限を素通りする。
    const exhausted = await deps.spendAttempt(actor.id);
    if (exhausted) return exhausted;

    const verified = await deps.verifyCode(headers, { code, kind });
    if (!verified.ok) return verified;
    await deps.resetAttempts(actor.id);

    const revoked = await deps.revokeOtherSessions(headers);
    if (!revoked.ok) return revoked;

    const disabled = await deps.disableTotp(headers);
    if (!disabled.ok) return disabled;

    // 記帳の失敗で手続き全体を落とさない (rotate 済みで巻き戻せない地点 — 理由の全文: activate.ts)。
    const { ip, userAgent } = getClientContext(headers);
    await deps.writeAudit({ userId: actor.id, ip, userAgent }).catch(deps.observeAuditError);

    return {
      ok: true,
      sessionChanges: mergeForwardedCookies(verified.headers, revoked.headers, disabled.headers),
      notifyEmail: actor.email,
    };
  };
}
