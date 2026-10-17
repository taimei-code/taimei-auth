import { Context, Effect, Layer } from "effect";
import { EmailSender } from "../src/email/ports";
import { emailSenderLive } from "../src/email/wiring";

export class MagicLinkOutbox extends Context.Service<
  MagicLinkOutbox,
  {
    record(email: string, url: string): Effect.Effect<void>;
    take(email: string): Effect.Effect<string | undefined>;
  }
>()("taimei/testing/MagicLinkOutbox") {}

export const makeMagicLinkOutbox = (): MagicLinkOutbox["Service"] => {
  const latestByEmail = new Map<string, string>();
  return MagicLinkOutbox.of({
    record: (email, url) => Effect.sync(() => void latestByEmail.set(email, url)),
    take: (email) =>
      Effect.sync(() => {
        const url = latestByEmail.get(email);
        latestByEmail.delete(email);
        return url;
      }),
  });
};

export const recordingEmailSender = (
  outbox: MagicLinkOutbox["Service"],
): Layer.Layer<EmailSender> =>
  Layer.succeed(
    EmailSender,
    EmailSender.of({
      ...emailSenderLive,
      sendMagicLink: (email, url) =>
        outbox.record(email, url).pipe(Effect.andThen(emailSenderLive.sendMagicLink(email, url))),
    }),
  );
