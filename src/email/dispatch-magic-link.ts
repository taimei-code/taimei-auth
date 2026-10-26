import { Effect } from "effect";
import { resolveInvitationEmailContext } from "../invitation/resolve-email-context";
import { EmailSender } from "./ports";

export const encodeCallbackURLForVerify = (magicLinkUrl: string): string => {
  const url = new URL(magicLinkUrl);
  const callbackURL = url.searchParams.get("callbackURL");
  if (callbackURL !== null) url.searchParams.set("callbackURL", encodeURIComponent(callbackURL));
  return url.toString();
};

export const callbackURLAfterVerify = (magicLinkUrl: string): string | null => {
  const callbackURL = new URL(magicLinkUrl).searchParams.get("callbackURL");
  return callbackURL === null ? null : decodeURIComponent(callbackURL);
};

export const dispatchMagicLink = Effect.fnUntraced(function* (email: string, url: string) {
  const sender = yield* EmailSender;
  const invitationContext = yield* resolveInvitationEmailContext(url);
  const sentUrl = encodeCallbackURLForVerify(url);
  if (invitationContext) {
    yield* sender.sendInvitation({ inviteeEmail: email, url: sentUrl, ...invitationContext });
    return;
  }
  yield* sender.sendMagicLink(email, sentUrl);
});
