import { recordMfaDisabled } from "@/db/repositories/audit-log";
import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import { captureAuditLogError } from "../audit-error";
import type { Actor } from "../membership/guard/core";
import { getClientContext } from "../request-context";
import { resetDisableAttempts, spendDisableAttempt } from "./disable-attempt-budget";
import { failure, type MfaFailure, NOT_ENABLED } from "./error-mapping";
import {
  disableTotp,
  mergeForwardedCookies,
  revokeOtherSessions,
  verifyMfaCode,
  type MfaCodeKind,
} from "./gateway";
import { requiresMfaChallenge } from "./policy";

// ADR-0012 (Use-case 層): 認証アプリの無効化手続。two_factor 行を削除し
// user.twoFactorEnabled を false に戻す。

export type DisableResult =
  | { ok: true; forwardedHeaders: Headers; notifyEmail: string }
  | MfaFailure;

// フラグと verified 行のどちらかが有効を主張していれば「今 MFA が効いている」と見なす。
// 両方を見るのは、中断した無効化が残す「フラグ false + verified 行」を運用救済でしか出られない
// 状態にしないため — enroll は同じ状態を already_enabled で拒むので、出口は disable しかない。
async function isMfaInEffect(actor: Actor): Promise<boolean> {
  if (requiresMfaChallenge(actor)) return true;
  return (await findTwoFactorVerificationState(actor.id))?.verified === true;
}

// 本人確認を先頭に置き、**コードが誤っていれば副作用を 1 つも起こさない**。パスワードを持たない
// 構成では現在の TOTP コードかリカバリーコードだけが「本人が第二要素を今も持っている」証拠で、
// これを後段に回すと誤コードでも他セッションの revoke やセッション rotate が起きてしまう。
// 成功後の順序は activate と同じ (revoke → rotate → audit → 宛先を Result で返す)。
//
// **セッションあり経路にはプラグインの試行制限が一切継承されない** (挙動: gateway.ts の
// verifyMfaCode、判断の詳細: ADR-0013)。誤コード連投の抑止はこの use-case が自前で持つ
// (disable-attempt-budget.ts)。
export async function disable(params: {
  actor: Actor;
  headers: Headers;
  code: string;
  kind: MfaCodeKind;
}): Promise<DisableResult> {
  const { actor, headers, code, kind } = params;

  // 前提条件をコード検証より前に置く。verifyTOTP は未有効化状態を有効化の合図として扱う
  // (gateway.ts の activateTotp) ため、未有効化のまま呼ぶと要求と正反対の有効化が成立する。
  if (!(await isMfaInEffect(actor))) return failure(NOT_ENABLED);

  // コード検証は 1 回ぶんの枠を消費してから通す。枠を確かめてから数える順にすると、同時に
  // 撃ち込まれた複数リクエストが全員「まだ 0 回」を読んで上限を素通りする。
  const exhausted = await spendDisableAttempt(actor.id);
  if (exhausted) return exhausted;

  const verified = await verifyMfaCode(headers, { code, kind });
  if (!verified.ok) return verified;
  await resetDisableAttempts(actor.id);

  const revoked = await revokeOtherSessions(headers);
  if (!revoked.ok) return revoked;

  const disabled = await disableTotp(headers);
  if (!disabled.ok) return disabled;

  // 記帳の失敗で手続き全体を落とさない (rotate 済みで巻き戻せない地点 — 理由の全文: activate.ts)。
  const { ip, userAgent } = getClientContext(headers);
  await recordMfaDisabled({ user_id: actor.id, ip, userAgent }).catch((e) =>
    captureAuditLogError("mfa_disabled", e),
  );

  return {
    ok: true,
    forwardedHeaders: mergeForwardedCookies(verified.headers, revoked.headers, disabled.headers),
    notifyEmail: actor.email,
  };
}
