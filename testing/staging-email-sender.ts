import { Layer } from "effect";
import { UNDELIVERABLE_EMAIL_DOMAIN } from "../db/testing/dev-accounts";
import { EmailSender } from "../src/email/ports";
import { emailSenderLive } from "../src/email/wiring";
import { type NonProductionEmail, recordingEmailSenderService } from "./sent-links";

type EmailSenderService = EmailSender["Service"];

const isUndeliverableAddress = (email: string) =>
  email.toLowerCase().endsWith(UNDELIVERABLE_EMAIL_DOMAIN);

export const emailSenderByRecipient = (
  recordingSender: EmailSenderService,
  deliveringSender: EmailSenderService,
): EmailSenderService => {
  const senderFor = (email: string) =>
    isUndeliverableAddress(email) ? recordingSender : deliveringSender;
  return EmailSender.of({
    sendWelcome: (email, userName) => senderFor(email).sendWelcome(email, userName),
    sendMagicLink: (email, url) => senderFor(email).sendMagicLink(email, url),
    sendInvitation: (params) => senderFor(params.inviteeEmail).sendInvitation(params),
    sendMfaEnabled: (email) => senderFor(email).sendMfaEnabled(email),
    sendMfaDisabled: (email) => senderFor(email).sendMfaDisabled(email),
  });
};

export const stagingEmail: NonProductionEmail = {
  sender: Layer.succeed(
    EmailSender,
    emailSenderByRecipient(recordingEmailSenderService, emailSenderLive),
  ),
  recordsEmailTo: isUndeliverableAddress,
};
