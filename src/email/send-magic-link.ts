import { isLocalEnvironment } from "../env";
import { getAppName, getMagicLinkFromEmail, renderAndSendEmail } from "./client";
import MagicLinkEmail from "./magic-link";

// ログインリンクメール送信。local は console.log fallback (Welcome / Invitation と同パターンで、
// e2e が server ログからリンクを拾う契約のため文言を変えないこと)。
export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  if (isLocalEnvironment()) {
    console.log(`[TEST] Magic Link for ${email}: ${url}`);
    return;
  }

  const appName = getAppName();
  await renderAndSendEmail({
    from: getMagicLinkFromEmail(),
    to: email,
    subject: `${appName} へのログインリンク`,
    component: MagicLinkEmail({ url, appName }),
    kind: "magic link",
  });
}
