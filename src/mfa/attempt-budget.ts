import { Effect } from "effect";
import { Redis } from "../redis-service";
import { captureCause } from "../sentry";

// Redis 計数の試行枠 kernel。**fail-closed — 数えられない時は必ず拒否する** (根拠: ADR-0013
// Consequences → ADR-0016 が引き継ぐ)。verdict の写像 (locked / チャレンジ破棄) は呼び出し側が持つ。

export type AttemptBudgetVerdict = "accepted" | "exhausted" | "unavailable";

// RedisError を E channel に載せない (fail-open にしない) ためにここで畳む。observation は残す —
// 計数不能が続いていることは Sentry でしか気付けない。
export const spendAttemptBudget = Effect.fn("mfa.spendAttemptBudget")(function* (input: {
  key: string;
  windowSeconds: number;
  maxAttempts: number;
  component: string;
}) {
  const redis = yield* Redis;
  const spent = yield* redis
    .incrementRateWindow(input.key, input.windowSeconds)
    .pipe(
      Effect.catchTag("RedisError", (failure) =>
        captureCause({ tags: { component: input.component } })(failure).pipe(Effect.as(null)),
      ),
    );
  // 成功した INCR は必ず 1 以上を返す。NaN だけでなく 0 も弾く — redis 層は欠損応答を
  // `Number(res[0] ?? 0)` で 0 に潰すため、0 を通すと storage 障害が fail-open に化ける。
  if (!spent || !(spent.count >= 1)) return "unavailable" as const;
  return spent.count > input.maxAttempts ? ("exhausted" as const) : ("accepted" as const);
});
