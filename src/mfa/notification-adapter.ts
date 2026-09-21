import { Effect } from "effect";
import { Background } from "../background";
import { EmailSender } from "../email/ports";
import { captureCause, captureCauseAs, type SentryService } from "../sentry";

const MFA_NOTIFICATION = { component: "mfa-notification" };

export const notifyMfaEnabled = (
  email: string,
): Effect.Effect<void, never, EmailSender | Background | SentryService> =>
  notifyInBackground((sender) => sender.sendMfaEnabled(email));

export const notifyMfaDisabled = (
  email: string,
): Effect.Effect<void, never, EmailSender | Background | SentryService> =>
  notifyInBackground((sender) => sender.sendMfaDisabled(email));

export const notifyMfaDisabledForManagement = Effect.fn("mfa.notifyMfaDisabledForManagement")(
  function* (email: string) {
    const sender = yield* EmailSender;
    return yield* sender
      .sendMfaDisabled(email)
      .pipe(Effect.as(true), Effect.catch(captureCauseAs(false, { tags: MFA_NOTIFICATION })));
  },
);

const notifyInBackground = (
  send: (sender: EmailSender["Service"]) => Effect.Effect<void, { readonly cause: unknown }>,
): Effect.Effect<void, never, EmailSender | Background | SentryService> =>
  Effect.gen(function* () {
    const sender = yield* EmailSender;
    const background = yield* Background;
    yield* background.run(
      send(sender).pipe(Effect.catch(captureCause({ tags: MFA_NOTIFICATION }))),
    );
  });
