// 多要素認証 (MFA) のロックアウト救済。認証アプリとリカバリーコードを両方失ったユーザーが
// 恒久ロックアウトから出る唯一の経路 (前提と手順: README.md の運用節 / ADR-0013)。
//
//   bun run management/disable-user-mfa.ts <userId>
//
// 削除・記帳は registration management port が所有し、ここは引数の解釈と結果の報告に徹する。
import { forceDisable } from "../src/mfa/registration/management";
import { notifyMfaDisabledForManagement } from "../src/mfa/registration/notification-adapter";

const userId = process.argv[2];
if (!userId) {
  console.error("usage: bun run management/disable-user-mfa.ts <userId>");
  process.exit(1);
}

const result = await forceDisable(userId);

if ("retryAfterSeconds" in result) {
  console.error(JSON.stringify({ userId, error: "temporarily_unavailable" }, null, 2));
  process.exit(1);
}

if (!result.ok) {
  // guard 取得中の user 削除 race は MfaFailure (error) で返る。pre-check の user_not_found (reason)
  // と同じ「対象不在」として報告する。
  console.error(
    JSON.stringify({ userId, error: "reason" in result ? result.reason : result.error }, null, 2),
  );
  process.exit(1);
}

// 既に無効なら何も変えずに成功で返す。ロックアウト対応中の再実行が「失敗」に見えると、
// 実際には不要な次の手 (DB 直接操作等) を運用者に踏ませてしまう。
if (!result.changed) {
  console.log(JSON.stringify({ userId, changed: false, reason: "mfa_not_enabled" }, null, 2));
  process.exit(0);
}

// 通知の失敗で解除自体を失敗扱いにしない (解除は確定済みで、再実行しても changed:false になる)。
// 送信可否は報告に載せ、届かなかった場合は運用者が別経路で本人に知らせる。
const notified = await notifyMfaDisabledForManagement(result.notifyEmail);

console.log(JSON.stringify({ userId, changed: true, notified }, null, 2));
// pg pool が開いたままだと process が終了しないため明示 exit する。
process.exit(0);
