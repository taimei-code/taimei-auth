import { Effect } from "effect";
import type { Background } from "../background";
import { type NotificationComponent, notifyInBackground } from "../email/notify-in-background";
import { EmailSender } from "../email/ports";
import { captureCauseAs, type SentryService } from "../sentry";

const MFA_NOTIFICATION: NotificationComponent = "mfa-notification";

export const notifyMfaEnabled = (
  email: string,
): Effect.Effect<void, never, EmailSender | Background | SentryService> =>
  notifyInBackground(MFA_NOTIFICATION, (sender) => sender.sendMfaEnabled(email));

export const notifyMfaDisabled = (
  email: string,
): Effect.Effect<void, never, EmailSender | Background | SentryService> =>
  notifyInBackground(MFA_NOTIFICATION, (sender) => sender.sendMfaDisabled(email));

export const notifyMfaDisabledForManagement = Effect.fnUntraced(function* (email: string) {
  const sender = yield* EmailSender;
  return yield* sender
    .sendMfaDisabled(email)
    .pipe(
      Effect.as(true),
      Effect.catch(captureCauseAs(false, { tags: { component: MFA_NOTIFICATION } })),
    );
});
