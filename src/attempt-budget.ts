import { Effect } from "effect";
import { Redis } from "./redis-service";
import { captureCause } from "./sentry";

// Redis 計数の試行枠 kernel。数えられなかった事実を `unavailable` として返すだけで、倒し方 (fail-closed /
// fail-open) は呼び手が verdict を写して決める (正本: CONTEXT.md「試行枠」。MFA の呼び手だけ fail-closed に
// 倒す理由は ADR-0013 Consequences → ADR-0016 が引き継ぐ)。invitation は unavailable を通し、MFA は拒否する。

export type AttemptBudgetVerdict = "accepted" | "exhausted" | "unavailable";

// RedisError を E channel に載せず unavailable に畳む (呼び手に障害の分岐を持たせない)。observation は残す —
// 計数不能が続いていることは Sentry でしか気付けない (level は captureCause の既定 warning、ADR-0017 Decision の Sentry 項)。
export const spendAttemptBudget = Effect.fn("attemptBudget.spend")(function* (input: {
  key: string;
  windowSeconds: number;
  maxAttempts: number;
  component: string;
}) {
  const redis = yield* Redis;
  const counted = yield* redis
    .incrementRateWindow(input.key, input.windowSeconds)
    .pipe(
      Effect.catchTag("RedisError", (failure) =>
        captureCause({ tags: { component: input.component } })(failure).pipe(Effect.as(null)),
      ),
    );
  // 不変条件 (成功した INCR は必ず 1 以上) の正本は redis.ts の toRateWindowResult で、契約逸脱は
  // そこで RedisError になる。ここは第 2 線として 0 / NaN を accepted に写さず unavailable に倒す。
  if (!counted || !(counted.count >= 1)) return "unavailable" as const;
  return counted.count > input.maxAttempts ? ("exhausted" as const) : ("accepted" as const);
});
