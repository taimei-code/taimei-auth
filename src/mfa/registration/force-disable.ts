import { recordMfaDisabled } from "@/db/repositories/audit-log";
import { deleteTwoFactorByUserId } from "@/db/repositories/two-factor";
import { captureAuditLogError } from "../../audit-error";
import { clearTwoFactorEnabled } from "../gateway";
import type { RegistrationSnapshot } from "./ports";

// ADR-0012 (Use-case 層): 運用救済としての MFA 強制解除。認証アプリとリカバリーコードを
// 両方失ったユーザーの唯一の出口 — ログイン手段は magic link / GitHub だけで再認証機構が無く、
// enroll は有効中なら 409、disable はコード必須のため、これが無いと恒久ロックアウトから出られない。
// CLI 殻は management/disable-user-mfa.ts (sweep-abandoned-signups と同じ 3 層構成)。

// 実行元を audit に残すための固定値。この経路にはリクエストが無く ip は null になる。
const MANAGEMENT_ACTOR = "management/disable-user-mfa";

export type ForceDisableResult =
  | { ok: true; changed: true; notifyEmail: string }
  | { ok: true; changed: false }
  | { ok: false; reason: "user_not_found" };

// **two_factor 行の削除を先に、フラグ降ろしを後に** 行う。逆順の中断は「フラグ false +
// verified 行」を残し、そこからの enroll が本人の知らない secret を黙って有効化する
// (機構: enroll.ts = 救済スクリプトが恒久ロックアウトを作る)。この順序なら中断は
// 「まだ解除されていない」に留まり、再実行で解消できる。2 つの書き込みは同一トランザクションに
// 入れられない (フラグ更新は better-auth の internalAdapter 経由のため)。
export async function forceDisableMfa(
  userId: string,
  snapshot: RegistrationSnapshot,
): Promise<ForceDisableResult> {
  if (snapshot.user === "absent") return { ok: false, reason: "user_not_found" };

  const deletedRows = await deleteTwoFactorByUserId(userId);
  if (deletedRows === 0 && !snapshot.twoFactorEnabled) return { ok: true, changed: false };

  await clearTwoFactorEnabled(userId);
  // 記帳の失敗で CLI を止めない。ここで throw すると解除自体は済んでいるのに本人通知が送られず、
  // かつ再実行は changed:false に落ちるため、通知の機会が永久に失われる。失敗は観測へ回す。
  await recordMfaDisabled({ user_id: userId, ip: null, userAgent: MANAGEMENT_ACTOR }).catch((e) =>
    captureAuditLogError("mfa_disabled", e),
  );

  return { ok: true, changed: true, notifyEmail: snapshot.email };
}
