import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { InvitationEmailParams } from "../../src/email/send-invitation";
import { EmailSender } from "../../src/email/ports";
import { recordingEmailSender, takeSentLink } from "../sent-links";

const EMAIL = "sent-links-test@example.com";
const RETURN_TO = "http://localhost:3000/after-sign-in";
const magicLinkTo = (callbackURL: string) =>
  `http://localhost:3100/api/auth/magic-link/verify?token=t&callbackURL=${encodeURIComponent(callbackURL)}`;

describe("試験の環境で送ったメールの URL を、宛先と戻り先で取り出す", () => {
  test("ログインの Magic Link の後に同じ宛先へ招待のメールを送っても、戻り先が一致するログインの URL を返す", async () => {
    const loginUrl = magicLinkTo(RETURN_TO);
    const invitationUrl = magicLinkTo("http://localhost:3100/auth/signup/accept-invitation");
    const taken = await Effect.runPromise(
      Effect.gen(function* () {
        const sender = yield* EmailSender;
        yield* sender.sendMagicLink(EMAIL, loginUrl);
        yield* sender.sendInvitation({
          inviteeEmail: EMAIL,
          url: invitationUrl,
        } as InvitationEmailParams);
        return yield* takeSentLink(EMAIL, RETURN_TO);
      }).pipe(Effect.provide(recordingEmailSender)),
    );
    expect(taken).toBe(loginUrl);
  });

  test("取り出した後は、同じ宛先に送った他の戻り先の URL も残さない", async () => {
    const invitationReturnTo = "http://localhost:3100/auth/signup/accept-invitation";
    const left = await Effect.runPromise(
      Effect.gen(function* () {
        const sender = yield* EmailSender;
        yield* sender.sendMagicLink(EMAIL, magicLinkTo(RETURN_TO));
        yield* sender.sendInvitation({
          inviteeEmail: EMAIL,
          url: magicLinkTo(invitationReturnTo),
        } as InvitationEmailParams);
        yield* takeSentLink(EMAIL, RETURN_TO);
        return yield* takeSentLink(EMAIL, invitationReturnTo);
      }).pipe(Effect.provide(recordingEmailSender)),
    );
    expect(left).toBeUndefined();
  });
});
