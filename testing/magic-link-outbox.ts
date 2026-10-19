import { Effect, Layer } from "effect";
import { EmailSender } from "../src/email/ports";
import { emailSenderLive } from "../src/email/wiring";

export type MagicLinkOutbox = {
  record(email: string, url: string): Effect.Effect<void>;
  take(email: string): Effect.Effect<string | undefined>;
};

export const makeMagicLinkOutbox = (): MagicLinkOutbox => {
  const latestByEmail = new Map<string, string>();
  return {
    record: (email, url) => Effect.sync(() => void latestByEmail.set(email, url)),
    take: (email) =>
      Effect.sync(() => {
        const url = latestByEmail.get(email);
        latestByEmail.delete(email);
        return url;
      }),
  };
};

export const recordingEmailSender = (outbox: MagicLinkOutbox): Layer.Layer<EmailSender> =>
  Layer.succeed(
    EmailSender,
    EmailSender.of({
      ...emailSenderLive,
      sendMagicLink: (email, url) =>
        outbox.record(email, url).pipe(Effect.andThen(emailSenderLive.sendMagicLink(email, url))),
    }),
  );
