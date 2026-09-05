import { Effect } from "effect";
import { Redis } from "../redis-service";
import { captureCause } from "../sentry";
import { spendAttemptBudget } from "./attempt-budget";
import { Locked } from "./error-mapping";

// ADR-0012 (Use-case 層): 無効化のコード検証に掛けるアカウント単位の試行上限。セッションあり経路で
// 6 桁の総当たりを止める唯一の防御 (軸・諸元の根拠: ADR-0013 Consequences → ADR-0016)。

// export しているのは、テストが TTL を観測する対象を production と同じキーに固定するため。
export const disableAttemptsKey = (userId: string): string => `mfa:disable-attempts:${userId}`;

// プラグインのロックより狭いのは、本人のセッションを前提にした操作で正規の打ち直しが数回に収まるため。
const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;
const COMPONENT = "mfa-disable-attempt-budget";

// 枠を使い切った時と数えられなかった時 (fail-closed) はどちらも Locked を E channel に載せる。
export const spendDisableAttempt = Effect.fn("mfa.spendDisableAttempt")(function* (userId: string) {
  const verdict = yield* spendAttemptBudget({
    key: disableAttemptsKey(userId),
    windowSeconds: WINDOW_SECONDS,
    maxAttempts: MAX_ATTEMPTS,
    component: COMPONENT,
  });
  if (verdict !== "accepted") return yield* new Locked();
});

// 数えているのは連続失敗なので、正しいコードを 1 度出せた本人に上限を持ち越さない。
// 消し損ねても手続きは止めない — 残った counter は TTL で消え、影響は次の枠が狭いままに留まる。
export const resetDisableAttempts = Effect.fn("mfa.resetDisableAttempts")(function* (
  userId: string,
) {
  const redis = yield* Redis;
  yield* redis
    .delete(disableAttemptsKey(userId))
    .pipe(Effect.catchTag("RedisError", captureCause({ tags: { component: COMPONENT } })));
});
