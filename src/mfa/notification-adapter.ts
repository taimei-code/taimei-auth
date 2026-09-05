import { Effect } from "effect";
import { Background } from "../background";
import { EmailSender } from "../email/ports";

// 通知は fire-and-forget の best-effort — 失敗を E channel に載せない (有効化 / 無効化の成立を通知失敗で
// 取り消さない)。送信の切り離しは Background service が所有する (worker は waitUntil で完走を待つ)。

export const notifyMfaEnabled = (
  email: string,
): Effect.Effect<void, never, EmailSender | Background> =>
  notifyInBackground((sender) => sender.sendMfaEnabled(email));

export const notifyMfaDisabled = (
  email: string,
): Effect.Effect<void, never, EmailSender | Background> =>
  notifyInBackground((sender) => sender.sendMfaDisabled(email));

// management CLI (management/disable-user-mfa.ts) 用の完走待ち版。送信結果を CLI の出力に載せるため
// background に切り離さず、失敗は false に畳む。
export const notifyMfaDisabledForManagement = Effect.fn("mfa.notifyMfaDisabledForManagement")(
  function* (email: string) {
    const sender = yield* EmailSender;
    return yield* sender.sendMfaDisabled(email).pipe(
      Effect.map(() => true),
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* Effect.logError("failed to send MFA disabled notification email", error.cause);
          return false;
        }),
      ),
    );
  },
);

const notifyInBackground = (
  send: (sender: EmailSender["Service"]) => Effect.Effect<void, { readonly cause: unknown }>,
): Effect.Effect<void, never, EmailSender | Background> =>
  Effect.gen(function* () {
    const sender = yield* EmailSender;
    const background = yield* Background;
    yield* background.run(
      send(sender).pipe(
        Effect.catch((error) =>
          Effect.logError("failed to send MFA notification email", error.cause),
        ),
      ),
    );
  });
