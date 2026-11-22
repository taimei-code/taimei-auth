import { Layer } from "effect";
import { EmailError, timeoutAsBoundary } from "../errors";
import { EmailSender } from "./ports";
import { sendInvitationEmail } from "./send-invitation";
import { sendMagicLinkEmail } from "./send-magic-link";
import {
  sendMfaDisabledEmail,
  sendMfaEnabledEmail,
  sendPasskeyChangedEmail,
} from "./send-security-notification";
import { sendWelcomeEmail } from "./send-welcome";

const withEmailTimeout = timeoutAsBoundary(EmailError, "10 seconds");

export const emailSenderLive = EmailSender.of({
  sendWelcome: (email, userName) => withEmailTimeout(sendWelcomeEmail(email, userName)),
  sendMagicLink: (email, url) => withEmailTimeout(sendMagicLinkEmail(email, url)),
  sendInvitation: (params) => withEmailTimeout(sendInvitationEmail(params)),
  sendMfaEnabled: (email) => withEmailTimeout(sendMfaEnabledEmail(email)),
  sendMfaDisabled: (email) => withEmailTimeout(sendMfaDisabledEmail(email)),
  sendPasskeyChanged: (params) => withEmailTimeout(sendPasskeyChangedEmail(params)),
});

export const EmailSenderLive: Layer.Layer<EmailSender> = Layer.succeed(
  EmailSender,
  emailSenderLive,
);
