import { Layer } from "effect";
import { EmailError, timeoutAsBoundary } from "../errors";
import { EmailSender } from "./ports";
import { sendInvitationEmail } from "./send-invitation";
import { sendMagicLinkEmail } from "./send-magic-link";
import { sendMfaDisabledEmail, sendMfaEnabledEmail } from "./send-mfa-notification";
import { sendWelcomeEmail } from "./send-welcome";

const withEmailTimeout = timeoutAsBoundary((cause) => new EmailError({ cause }), "10 seconds");

export const emailSenderLive = EmailSender.of({
  sendWelcome: (email, userName) => withEmailTimeout(sendWelcomeEmail(email, userName)),
  sendMagicLink: (email, url) => withEmailTimeout(sendMagicLinkEmail(email, url)),
  sendInvitation: (params) => withEmailTimeout(sendInvitationEmail(params)),
  sendMfaEnabled: (email) => withEmailTimeout(sendMfaEnabledEmail(email)),
  sendMfaDisabled: (email) => withEmailTimeout(sendMfaDisabledEmail(email)),
});

export const EmailSenderLive: Layer.Layer<EmailSender> = Layer.succeed(
  EmailSender,
  emailSenderLive,
);
