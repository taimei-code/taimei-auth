import { Effect, Layer } from "effect";
import { AuthApi } from "../src/auth-service";
import { EmailSender } from "../src/email/ports";
import {
  invitationLogLine,
  magicLinkLogLine,
  mfaNotificationLogLine,
  WELCOME_EMAIL_LOG,
} from "./local-delivery-log";

const sentLinks = new Map<string, string[]>();

const sentLinksKey = (email: string, callbackURL: string | null) =>
  JSON.stringify([email, callbackURL]);

const record = (email: string, url: string) =>
  Effect.sync(() => {
    const key = sentLinksKey(email, new URL(url).searchParams.get("callbackURL"));
    const urls = sentLinks.get(key);
    if (urls) urls.push(url);
    else sentLinks.set(key, [url]);
  });

export const takeSentLink = (email: string, callbackURL: string) =>
  Effect.sync(() => {
    const key = sentLinksKey(email, callbackURL);
    const urls = sentLinks.get(key);
    const url = urls?.pop();
    if (urls?.length === 0) sentLinks.delete(key);
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
