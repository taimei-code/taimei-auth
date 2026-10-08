import { Effect } from "effect";
import { resolveInvitationEmailContext } from "../invitation/resolve-email-context";
import { EmailSender } from "./ports";

export const dispatchMagicLink = Effect.fnUntraced(function* (email: string, url: string) {
  const sender = yield* EmailSender;
  const invitationContext = yield* resolveInvitationEmailContext(url);
  if (invitationContext) {
    yield* sender.sendInvitation({ inviteeEmail: email, url, ...invitationContext });
    return;
  }
  yield* sender.sendMagicLink(email, url);
});
