import { Effect } from "effect";
import { Background } from "../background";
import { captureCause, type SentryService } from "../sentry";
import { EmailSender } from "./ports";

export type NotificationComponent = "mfa-notification";

export const notifyInBackground = (
  component: NotificationComponent,
  send: (sender: EmailSender["Service"]) => Effect.Effect<void, { readonly cause: unknown }>,
): Effect.Effect<void, never, EmailSender | Background | SentryService> =>
  Effect.gen(function* () {
    const sender = yield* EmailSender;
    const background = yield* Background;
    yield* background.run(send(sender).pipe(Effect.catch(captureCause({ tags: { component } }))));
  });
