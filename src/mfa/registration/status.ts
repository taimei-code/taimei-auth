import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import { incrementRateWindow } from "../../redis";
import { Sentry } from "../../sentry";
import { countRemainingRecoveryCodes } from "../gateway";
import { requiresMfaChallenge } from "../policy";
import type { MfaActor } from "./contracts";
import { enrollmentFactsFor } from "./state";

// ADR-0012 (Use-case 層): セキュリティページ向けの MFA 状態取得。

// inEffect = 第二要素がまだ効いているか (enabled=false でも「中断した無効化」は true)。SPA は
// enabled でなくこれで disable / enroll を出し分ける — enroll は 409 なので出口を disable にする。
// (`//` で書くのは containment tripwire がブロックコメントを素通しするため — 型名リテラルの誤検出回避)
export type MfaStatus = {
  enabled: boolean;
  inEffect: boolean;
  recoveryCodesRemaining: number;
};

// 「中断した有効化」滞留ユーザーが画面を再訪するたびに error event が積み上がるのを防ぐ throttle。
// user 単位に窓を持つので取りこぼしはなく (kill-switch の全体 1 本とはここが違う)、並行 disable の
// 一過的な false-positive の連発も窓 1 回に丸める。6h はオンコール交代を必ず 1 回またぐ粒度。
const INTERRUPTED_REPORT_WINDOW_SECONDS = 6 * 60 * 60;
// export しているのは、テストが窓をリセットする対象を production と同じキーに固定するため
// (disable-attempt-budget.ts の disableAttemptsKey と同形)。
export const interruptedReportKey = (userId: string): string =>
  `mfa:interrupted-reported:${userId}`;

// 窓内の最初の 1 hit だけ通報を許す (INCR の count===1)。incrementRateWindow は hit ごとに
// EXPIRE を引き直すスライディング窓なので、滞留して再訪し続ける間は 1 エピソード 1 回に丸まる。
// throttle 自体が失敗したら通報を通す (検出を止めない fail-open。過剰通報より欠測を避ける)。
async function claimInterruptedReport(userId: string): Promise<boolean> {
  const { count } = await incrementRateWindow(
    interruptedReportKey(userId),
    INTERRUPTED_REPORT_WINDOW_SECONDS,
  );
  return count === 1;
}

async function reportInterruptedActivation(
  actor: MfaActor,
  interrupted: { enrollmentRecord: "absent" | "unverified" },
): Promise<void> {
  const fresh = await claimInterruptedReport(actor.id).catch(() => true);
  if (!fresh) return;
  Sentry.captureMessage("mfa: enabled flag without verified two factor row", {
    level: "error",
    tags: { component: "mfa-read-status" },
    extra: { userId: actor.id, enrollmentRecord: interrupted.enrollmentRecord },
  });
}

// enabled はチャレンジ判定と同じ述語を通す (規律: policy.ts)。「MFA 登録状態」の kind から
// 導出しないのは、表示とチャレンジ要否の導出が分かれると「画面では有効なのにチャレンジが出ない」
// 型の判定二重化が再発するため。
//
// 残数取得は enabled かつ「中断した有効化」でないときだけ行う。中断状態 (特に行なし) で呼ぶと
// gateway の「有効ユーザーに限る (行が存在する)」契約を破って captureException を汚し、
// 本当に viewBackupCodes が壊れた時の信号が埋もれる。
export async function readStatus(actor: MfaActor): Promise<MfaStatus> {
  const enabled = requiresMfaChallenge(actor);
  const facts = enrollmentFactsFor(actor, await findTwoFactorVerificationState(actor.id));

  if (facts.interrupted) await reportInterruptedActivation(actor, facts.interrupted);

  const recoveryCodesRemaining =
    enabled && !facts.interrupted ? await countRemainingRecoveryCodes(actor) : 0;

  return { enabled, inEffect: facts.inEffect, recoveryCodesRemaining };
}
