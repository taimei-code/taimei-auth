import { Effect } from "effect";
import { isLocalEnvironment } from "../env";
import { getAppName, getMagicLinkFromEmail, renderAndSendEmail } from "./client";
import { magicLinkLogLine } from "./local-delivery-log";
import MagicLinkEmail from "./magic-link";

export const sendMagicLinkEmail = Effect.fnUntraced(function* (email: string, url: string) {
  if (isLocalEnvironment()) {
    yield* Effect.sync(() => console.log(magicLinkLogLine(email, url)));
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
