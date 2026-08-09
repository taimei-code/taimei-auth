import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import type { Actor } from "../membership/guard/core";
import { Sentry } from "../sentry";
import { countRemainingRecoveryCodes } from "./gateway";
import { requiresMfaChallenge } from "./policy";

// ADR-0012 (Use-case 層): セキュリティページ向けの MFA 状態取得。

export type MfaStatus = { enabled: boolean; recoveryCodesRemaining: number };

// enabled はチャレンジ判定と同じ述語を通す。画面の表示とログイン時の実挙動が食い違わないよう、
// 条件式をここに書き下ろさないこと。
//
// 有効化は「user.twoFactorEnabled を true にする」と「two_factor 行を verified にする」の
// 2 つの書き込みで成り、両者は同一トランザクションに入らない (better-auth 側の実装)。間で失敗すると
// 「フラグは true だが行は未 verified」= チャレンジは要求されるが検証は必ず TOTP_NOT_ENABLED で
// 落ちる復帰不能状態になる。不変条件を「常に成り立つ」と仮定せず、状態を読むこの経路で検出して
// 観測に載せる (復帰は disable か management/disable-user-mfa.ts)。
export async function readStatus(actor: Actor): Promise<MfaStatus> {
  const enabled = requiresMfaChallenge(actor);
  const verificationState = await findTwoFactorVerificationState(actor.id);

  if (enabled && !verificationState?.verified) {
    Sentry.captureMessage("mfa: enabled flag without verified two factor row", {
      level: "error",
      tags: { component: "mfa-read-status" },
      extra: { userId: actor.id, hasRow: verificationState !== undefined },
    });
  }

  // 残数の取得は有効時のみ。未設定ユーザーにも問い合わせると、行が無い前提の失敗を
  // gateway 側で毎回観測してしまう (この短絡が gateway の「有効ユーザーに限る」契約の実装)。
  return {
    enabled,
    recoveryCodesRemaining: enabled ? await countRemainingRecoveryCodes(actor) : 0,
  };
}
