// 多要素認証 (MFA) のロックアウト救済。認証アプリとリカバリーコードを両方失ったユーザーが
// 恒久ロックアウトから出る唯一の経路 (前提と手順: README.md の運用節 / ADR-0013)。
//
//   bun run management/disable-user-mfa.ts <userId>
//
// 削除・記帳は src/mfa/force-disable.ts が所有し、ここは引数の解釈と結果の報告に徹する
// (sweep-abandoned-signups.ts と同じ 3 層構成)。通知メールを CLI 側で送るのは、use-case が
// src/email/ を import しない層分担を handler 経路 (src/handlers/account-mfa.ts) と揃えるため。
import { sendMfaDisabledEmail } from "../src/email/send-mfa-notification";
import { forceDisableMfa } from "../src/mfa/force-disable";

const userId = process.argv[2];
if (!userId) {
  console.error("usage: bun run management/disable-user-mfa.ts <userId>");
  process.exit(1);
}

const result = await forceDisableMfa(userId);

if (!result.ok) {
  console.error(JSON.stringify({ userId, error: result.reason }, null, 2));
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
const notified = await sendMfaDisabledEmail(result.notifyEmail)
  .then(() => true)
  .catch((e: unknown) => {
    console.error("failed to send MFA disabled notification email", e);
    return false;
  });

console.log(JSON.stringify({ userId, changed: true, notified }, null, 2));
// pg pool が開いたままだと process が終了しないため明示 exit する。
process.exit(0);
