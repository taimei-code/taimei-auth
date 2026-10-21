import { Effect, Layer } from "effect";
import { EmailSender } from "../src/email/ports";
import { emailSenderLive } from "../src/email/wiring";

const sentLinks = new Map<string, Map<string | null, string>>();

const record = (email: string, url: string) =>
  Effect.sync(() => {
    const byCallbackURL = sentLinks.get(email) ?? new Map<string | null, string>();
    byCallbackURL.set(new URL(url).searchParams.get("callbackURL"), url);
    sentLinks.set(email, byCallbackURL);
  });

export const takeSentLink = (email: string, callbackURL: string) =>
  Effect.sync(() => {
    const url = sentLinks.get(email)?.get(callbackURL);
    sentLinks.delete(email);
    return url;
  });

export const recordingEmailSender: Layer.Layer<EmailSender> = Layer.succeed(
  EmailSender,
  EmailSender.of({
    ...emailSenderLive,
    sendMagicLink: (email, url) =>
      record(email, url).pipe(Effect.andThen(emailSenderLive.sendMagicLink(email, url))),
    sendInvitation: (params) =>
      record(params.inviteeEmail, params.url).pipe(
        Effect.andThen(emailSenderLive.sendInvitation(params)),
      ),
  }),
);
