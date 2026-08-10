import { incrementRateWindow, redisStorage } from "../redis";
import { Sentry } from "../sentry";
import { failure, LOCKED, type MfaFailure } from "./error-mapping";

// ADR-0012 (Use-case 層): 無効化のコード検証に掛けるアカウント単位の試行上限。プラグインの
// 試行制限も汎用 rate limit も届かないセッションあり経路で、session cookie を盗んだ攻撃者に
// よる 6 桁の総当たりはここでしか止まらない (詳細: docs/adr/0013-mfa-totp-challenge.md)。

// セッション単位にすると、cookie を盗んだ攻撃者がセッションを取り直すたびに枠を得られる。
// export しているのは、テストが TTL を観測する対象を production と同じキーに固定するため。
export const disableAttemptsKey = (userId: string): string => `mfa:disable-attempts:${userId}`;

// プラグインのアカウントロック (gateway.ts の verifyMfaCode) より狭いのは、本人のセッションを
// 前提にした操作で正規利用の打ち直しが数回に収まるため。TTL は試行のたびに引き直され、
// 連投を続ける間は解けない。
const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;

// **fail-closed — 数えられない時は必ず拒否する** (fail-open との使い分けの判断: ADR-0013)。
export async function spendDisableAttempt(userId: string): Promise<MfaFailure | undefined> {
  const spent = await incrementRateWindow(disableAttemptsKey(userId), WINDOW_SECONDS).catch(
    (error: unknown) => {
      Sentry.captureException(error, { tags: { component: "mfa-disable-attempt-budget" } });
      return null;
    },
  );
  // INCR の失敗を戻り値側に載せる backend では count が NaN になり、上限との比較が常に false で
  // 素通りする。数値でないことも storage 障害と同じ扱いにする。
  if (!spent || !Number.isFinite(spent.count)) return failure(LOCKED);
  return spent.count > MAX_ATTEMPTS ? failure(LOCKED) : undefined;
}

// 数えているのは連続失敗なので、正しいコードを 1 度出せた本人に上限を持ち越さない。
// 消し損ねても手続きは止めない (理由は disable.ts の audit 記帳と同じ)。残った counter は TTL で
// 消え、影響は次の無効化までの枠が狭いままに留まる。
export async function resetDisableAttempts(userId: string): Promise<void> {
  await redisStorage.delete(disableAttemptsKey(userId)).catch((error: unknown) => {
    Sentry.captureException(error, { tags: { component: "mfa-disable-attempt-budget" } });
  });
}
