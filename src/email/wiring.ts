import { Layer } from "effect";
import { EmailError, timeoutAsBoundary } from "../errors";
import { EmailSender } from "./ports";
import { sendInvitationEmail } from "./send-invitation";
import { sendMagicLinkEmail } from "./send-magic-link";
import { sendMfaDisabledEmail, sendMfaEnabledEmail } from "./send-mfa-notification";
import { sendWelcomeEmail } from "./send-welcome";

// production 結線。送信は 10s で timeout し EmailError に畳む (ADR-0017 Decision の非同期項)。retry はしない (二重送信)。
// timeout は fiber を interrupt するだけで Resend への HTTP は取り消せないため、10s を超えて届いた送信は
// 「EmailError を返したが実際は送られた」になりうる。caller は EmailError を再送の根拠にしない (ADR-0017 Consequences)。
const withEmailTimeout = timeoutAsBoundary((cause) => new EmailError({ cause }), "10 seconds");

export const EmailSenderLive = Layer.succeed(
  EmailSender,
  EmailSender.of({
    sendWelcome: (email, userName) => withEmailTimeout(sendWelcomeEmail(email, userName)),
    sendMagicLink: (email, url) => withEmailTimeout(sendMagicLinkEmail(email, url)),
    sendInvitation: (params) => withEmailTimeout(sendInvitationEmail(params)),
    sendMfaEnabled: (email) => withEmailTimeout(sendMfaEnabledEmail(email)),
    sendMfaDisabled: (email) => withEmailTimeout(sendMfaDisabledEmail(email)),
  }),
);
