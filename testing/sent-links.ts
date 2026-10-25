import { Effect, Layer } from "effect";
import { AuthApi } from "../src/auth-service";
import { EmailSender } from "../src/email/ports";
import {
  invitationLogLine,
  magicLinkLogLine,
  mfaNotificationLogLine,
  WELCOME_EMAIL_LOG,
} from "./local-delivery-log";

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

export const magicLinkUrlFor = Effect.fnUntraced(function* (email: string, callbackURL: string) {
  yield* AuthApi.use((authApi) => authApi.signInMagicLink({ email, callbackURL }));
  const url = yield* takeSentLink(email, callbackURL);
  if (url === undefined) {
    return yield* Effect.die(
      new Error("no email to the user was recorded with the callbackURL of the Magic Link"),
    );
  }
  return url;
});

const logLine = (line: string) => Effect.sync(() => console.log(line));

export const recordingEmailSenderService = EmailSender.of({
  sendWelcome: (email) => logLine(`${WELCOME_EMAIL_LOG} ${email}`),
  sendMagicLink: (email, url) =>
    record(email, url).pipe(Effect.andThen(logLine(magicLinkLogLine(email, url)))),
  sendInvitation: (params) =>
    record(params.inviteeEmail, params.url).pipe(
      Effect.andThen(logLine(invitationLogLine(params.inviteeEmail, params.url))),
    ),
  sendMfaEnabled: (email) => logLine(mfaNotificationLogLine("enabled", email)),
  sendMfaDisabled: (email) => logLine(mfaNotificationLogLine("disabled", email)),
});

export const recordingEmailSender: Layer.Layer<EmailSender> = Layer.succeed(
  EmailSender,
  recordingEmailSenderService,
);
