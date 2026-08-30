import { incrementRateWindow } from "../redis";
import { Sentry } from "../sentry";

// Redis 計数の試行枠 kernel。**fail-closed — 数えられない時は必ず拒否する** (根拠: ADR-0013
// Consequences → ADR-0016 が引き継ぐ)。verdict の写像 (locked / チャレンジ破棄) は呼び出し側が持つ。

export type AttemptBudgetVerdict = "accepted" | "exhausted" | "unavailable";

export async function spendAttemptBudget(input: {
  key: string;
  windowSeconds: number;
  max: number;
  component: string;
}): Promise<AttemptBudgetVerdict> {
  const spent = await incrementRateWindow(input.key, input.windowSeconds).catch(
    (error: unknown) => {
      Sentry.captureException(error, { tags: { component: input.component } });
      return null;
    },
  );
  // 成功した INCR は必ず 1 以上を返す。NaN だけでなく 0 も弾く — redis 層は欠損応答を
  // `Number(res[0] ?? 0)` で 0 に潰すため、0 を通すと storage 障害が fail-open に化ける。
  if (!spent || !(spent.count >= 1)) return "unavailable";
  return spent.count > input.max ? "exhausted" : "accepted";
}
