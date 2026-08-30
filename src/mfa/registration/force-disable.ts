import { recordMfaDisabled } from "@/db/repositories/audit-log";
import { deleteTwoFactorByUserId } from "@/db/repositories/two-factor";
import { captureAuditLogError } from "../../audit-error";
import { failure, USER_NOT_FOUND, type MfaFailure } from "../error-mapping";
import { clearTwoFactorEnabled } from "../gateway";
import type { RegistrationSnapshot } from "./ports";

// ADR-0012 (Use-case 層): MFA 運用救済としての強制解除 — 認証アプリとリカバリーコードを両方失った
// ユーザーが恒久ロックアウトから出る唯一の出口 (位置づけ: ADR-0013 Consequences)。
// CLI 殻は management/disable-user-mfa.ts。

// 実行元を audit に残すための固定値。この経路にはリクエストが無く ip は null になる。
const MANAGEMENT_ACTOR = "management/disable-user-mfa";

export type ForceDisableResult =
  | { ok: true; changed: true; notifyEmail: string }
  | { ok: true; changed: false }
  | MfaFailure;

// **行の削除を先に、フラグ降ろしを後に** 行う。逆順の中断は「フラグ false + verified 行」を残し、
// そこからの enroll が本人の知らない secret を黙って有効化する。この順序なら中断は「まだ解除されて
// いない」に留まり再実行で解消できる (2 書き込みは同一 tx に入れられない。順序の正本: ADR-0013 §7)。
export async function forceDisableMfa(
  userId: string,
  snapshot: RegistrationSnapshot,
): Promise<ForceDisableResult> {
  if (snapshot.user === "absent") return failure(USER_NOT_FOUND);

  const deletedRows = await deleteTwoFactorByUserId(userId);
  if (deletedRows === 0 && !snapshot.twoFactorEnabled) return { ok: true, changed: false };

  await clearTwoFactorEnabled(userId);
  // 記帳の失敗で CLI を止めない。throw すると解除済みなのに通知が送られず、再実行は changed:false に
  // 落ちるため通知の機会が永久に失われる。失敗は観測へ回す。
  await recordMfaDisabled({ user_id: userId, ip: null, userAgent: MANAGEMENT_ACTOR }).catch((e) =>
    captureAuditLogError("mfa_disabled", e),
  );

  return { ok: true, changed: true, notifyEmail: snapshot.email };
}
