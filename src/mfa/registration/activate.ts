import { recordMfaEnabled } from "@/db/repositories/audit-log";
import { captureAuditLogError } from "../../audit-error";
import type { Actor } from "../../membership/guard/core";
import { getClientContext } from "../../request-context";
import { ENROLLMENT_CHANGED, failure, type MfaFailure } from "../error-mapping";
import { activateTotp, mergeForwardedCookies, revokeOtherSessions } from "../gateway";
import type { RegistrationSnapshot } from "./ports";
import { currentEnrollment, ensureCanActivate } from "./state";

// ADR-0012 (Use-case 層): 認証アプリの有効化手続。登録済み (未 verified) の two_factor 行を
// 6 桁コードで verified 化し、user.twoFactorEnabled を true にする。

export type ActivateResult =
  | { ok: true; forwardedHeaders: Headers; notifyEmail: string }
  | MfaFailure;

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
export async function activate(params: {
  actor: Actor;
  headers: Headers;
  code: string;
  enrollmentId?: string;
  snapshot?: RegistrationSnapshot;
}): Promise<ActivateResult> {
  const { actor, headers, code, enrollmentId, snapshot } = params;

  // 前提条件は revoke より前に置く。後ろに回すと、未登録のまま呼ばれた no-op が
  // 「何も有効化しないまま全デバイスをログアウトさせる」副作用だけを残す。
  // 受理条件の正本は registration/state.ts と ADR-0013 の状態マトリクス。
  const rejected = await ensureCanActivate(actor, snapshot);
  if (rejected) return rejected;

  if (enrollmentId !== undefined) {
    const current = await currentEnrollment(actor, snapshot);
    if (current?.id !== enrollmentId) return failure(ENROLLMENT_CHANGED);
  }

  const revoked = await revokeOtherSessions(headers);
  if (!revoked.ok) return revoked;

  const activated = await activateTotp(headers, code);
  if (!activated.ok) return activated;

  // 記帳の失敗で手続き全体を落とさない。ここはセッション rotate が済んで巻き戻せない地点で、
  // 例外を投げると handler が Set-Cookie を転送できず、有効化した本人が今のデバイスからログアウトし、
  // 通知メールも送られない (= 有効化されたことに誰も気づけない) 状態になる。失敗は観測へ回す。
  const { ip, userAgent } = getClientContext(headers);
  await recordMfaEnabled({ user_id: actor.id, ip, userAgent }).catch((e) =>
    captureAuditLogError("mfa_enabled", e),
  );

  return {
    ok: true,
    forwardedHeaders: mergeForwardedCookies(revoked.headers, activated.headers),
    notifyEmail: actor.email,
  };
}
