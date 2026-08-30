import { incrementRateWindow, redisStorage } from "../redis";
import { Sentry } from "../sentry";
import { failure, LOCKED, type MfaFailure } from "./error-mapping";

// ADR-0012 (Use-case 層): 無効化のコード検証に掛けるアカウント単位の試行上限。セッションあり経路で
// 6 桁の総当たりを止める唯一の防御 (軸・諸元・fail-closed の根拠: ADR-0013 Consequences)。

// export しているのは、テストが TTL を観測する対象を production と同じキーに固定するため。
export const disableAttemptsKey = (userId: string): string => `mfa:disable-attempts:${userId}`;

// プラグインのロックより狭いのは、本人のセッションを前提にした操作で正規の打ち直しが数回に収まるため。
const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;

// **fail-closed — 数えられない時は必ず拒否する** (fail-open との使い分け: ADR-0013 Consequences)。
export async function spendDisableAttempt(userId: string): Promise<MfaFailure | undefined> {
  const spent = await incrementRateWindow(disableAttemptsKey(userId), WINDOW_SECONDS).catch(
    (error: unknown) => {
      Sentry.captureException(error, { tags: { component: "mfa-disable-attempt-budget" } });
      return null;
    },
  );
  // INCR 失敗を戻り値に載せる backend では count が NaN になり上限比較が常に false で素通りするため、
  // 数値でないことも storage 障害と同じ扱いにする。
  if (!spent || !Number.isFinite(spent.count)) return failure(LOCKED);
  return spent.count > MAX_ATTEMPTS ? failure(LOCKED) : undefined;
}

// 数えているのは連続失敗なので、正しいコードを 1 度出せた本人に上限を持ち越さない。
// 消し損ねても手続きは止めない — 残った counter は TTL で消え、影響は次の枠が狭いままに留まる。
export async function resetDisableAttempts(userId: string): Promise<void> {
  await redisStorage.delete(disableAttemptsKey(userId)).catch((error: unknown) => {
    Sentry.captureException(error, { tags: { component: "mfa-disable-attempt-budget" } });
  });
}
