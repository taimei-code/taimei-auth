import { Effect } from "effect";
import { resolveInvitationEmailContext } from "../invitation/resolve-email-context";
import { EmailSender } from "./ports";

// better-auth magicLink plugin の sendMagicLink callback 本体。callbackURL に invitation_token があれば
// 事業所名 / 招待者を載せた招待メール、無ければ通常のログインリンクメールを送る。
export const dispatchMagicLink = Effect.fn("email.dispatchMagicLink")(function* (
  email: string,
  url: string,
) {
  const sender = yield* EmailSender;
  const invitationContext = yield* resolveInvitationEmailContext(url);
  if (invitationContext) {
    yield* sender.sendInvitation({ inviteeEmail: email, url, ...invitationContext });
    return;
  }
  yield* sender.sendMagicLink(email, url);
});
