import { Effect } from "effect";
import type { ReactElement } from "react";
import { Resend } from "resend";
import { EmailError, tryEmail } from "../errors";

let resendInstance: Resend | null = null;

// 全メールが同じ render → send → error 変換を辿るためここに閉じ、送信基盤の差し替え点を 1 箇所にする。
// provider (Resend) と render は境界: 失敗は EmailError (cause: unknown) で E channel に載せる (ADR-0017)。
export const renderAndSendEmail = Effect.fn("email.renderAndSend")(function* (params: {
  from: string;
  to: string;
  subject: string;
  component: ReactElement;
  kind: "magic link" | "welcome" | "invitation" | "mfa enabled" | "mfa disabled";
}) {
  // render は workerd バンドルで esbuild の lazy CJS init が走らず undefined になるため、dynamic import で
  // module init を強制する (ADR-0011)。実行時に react を引くので react / react-dom は devDependencies へ移さない。
  const { render } = yield* tryEmail(() => import("@react-email/components"));
  const [html, text] = yield* Effect.all(
    [
      tryEmail(() => render(params.component)),
      tryEmail(() => render(params.component, { plainText: true })),
    ],
    { concurrency: "unbounded" },
  );

  const { error } = yield* tryEmail(() =>
    getResendClient().emails.send({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html,
      text,
    }),
  );

  if (error) {
    yield* Effect.logError(`Failed to send ${params.kind} email:`, error);
    return yield* new EmailError({ cause: new Error(`Email sending failed: ${error.message}`) });
  }
});

export function getResendClient(): Resend {
  if (!resendInstance) {
    const apiKey = process.env.AUTH_RESEND_KEY;

    if (!apiKey) {
      throw new Error("AUTH_RESEND_KEY is not configured. Please set it in .env file.");
    }

    resendInstance = new Resend(apiKey);
  }

  return resendInstance;
}

// env は毎回読む (module ロード時に固定すると worker の再バインドや test の差し替えが効かない)。
const envOr = (key: string, fallback: string): string => process.env[key] || fallback;

export const getWelcomeFromEmail = () => envOr("AUTH_FROM_EMAIL_WELCOME", "onboarding@resend.dev");
export const getMagicLinkFromEmail = () =>
  envOr("AUTH_FROM_EMAIL_MAGIC_LINK", "onboarding@resend.dev");
export const getInvitationFromEmail = () =>
  envOr("AUTH_FROM_EMAIL_INVITATION", "onboarding@resend.dev");
export const getSecurityFromEmail = () =>
  envOr("AUTH_FROM_EMAIL_SECURITY", "onboarding@resend.dev");
export const getSupportEmail = () => envOr("AUTH_SUPPORT_EMAIL", "support@taimei-code.com");
export const getAbuseInfoUrl = () =>
  envOr("AUTH_ABUSE_INFO_URL", "https://taimei-code.com/security");
export const getAppName = () => envOr("APP_NAME", "taimei");
export const getAppUrl = () => envOr("AUTH_SERVICE_URL", "http://localhost:3100");
