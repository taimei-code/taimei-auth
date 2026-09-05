import { Effect } from "effect";
import { isLocalEnvironment } from "../env";
import { getAppName, getMagicLinkFromEmail, renderAndSendEmail } from "./client";
import MagicLinkEmail from "./magic-link";

// ログインリンクメール送信。local は console.log fallback (e2e がログからリンクを拾うため文言を変えない)。
export const sendMagicLinkEmail = Effect.fn("email.sendMagicLink")(function* (
  email: string,
  url: string,
) {
  if (isLocalEnvironment()) {
    yield* Effect.sync(() => console.log(`[TEST] Magic Link for ${email}: ${url}`));
    return;
  }

  const appName = getAppName();
  yield* renderAndSendEmail({
    from: getMagicLinkFromEmail(),
    to: email,
    subject: `${appName} へのログインリンク`,
    component: MagicLinkEmail({ url, appName }),
    kind: "magic link",
  });
});
