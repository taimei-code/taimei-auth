import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { EmailSender } from "../../src/email/ports";
import { toDisplayText } from "../../src/email/sanitize";
import { emailSenderByRecipient } from "../staging-email-sender";

type Delivery = readonly [kind: string, email: string];

const spySender = (deliveries: Delivery[]) =>
  EmailSender.of({
    sendWelcome: (email) => Effect.sync(() => void deliveries.push(["welcome", email])),
    sendMagicLink: (email) => Effect.sync(() => void deliveries.push(["magic-link", email])),
    sendInvitation: ({ inviteeEmail }) =>
      Effect.sync(() => void deliveries.push(["invitation", inviteeEmail])),
    sendMfaEnabled: (email) => Effect.sync(() => void deliveries.push(["mfa-enabled", email])),
    sendMfaDisabled: (email) => Effect.sync(() => void deliveries.push(["mfa-disabled", email])),
  });

const sendAllKindsTo = (email: string) => {
  const recorded: Delivery[] = [];
  const sent: Delivery[] = [];
  const sender = emailSenderByRecipient(spySender(recorded), spySender(sent));
  Effect.runSync(
    Effect.all([
      sender.sendWelcome(email, toDisplayText("利用者")),
      sender.sendMagicLink(email, "https://auth.example/verify"),
      sender.sendInvitation({
        inviteeEmail: email,
        url: "https://auth.example/verify",
        companyName: toDisplayText("事業所"),
        inviterName: toDisplayText("招待した人"),
        inviterEmail: toDisplayText("inviter@example.org"),
        roleLabel: "メンバー",
      }),
      sender.sendMfaEnabled(email),
      sender.sendMfaDisabled(email),
    ]),
  );
  return { recorded: recorded.map(([kind]) => kind), sent: sent.map(([kind]) => kind) };
};

const ALL_KINDS = ["welcome", "magic-link", "invitation", "mfa-enabled", "mfa-disabled"];

describe("staging のメールは、届かない domain の開発用アカウント宛てだけを記録し、ほかは送る", () => {
  test.each([
    "dev-owner@example.com",
    "Dev-Owner@Example.COM",
  ])("%s 宛ての 5 種のメールは記録し、送り手に渡さない", (email) => {
    expect(sendAllKindsTo(email)).toEqual({ recorded: ALL_KINDS, sent: [] });
  });

  test.each([
    "someone@example.org",
    "someone@sub.example.com",
    "example.com@example.org",
  ])("%s 宛ての 5 種のメールは送り手に渡し、記録しない", (email) => {
    expect(sendAllKindsTo(email)).toEqual({ recorded: [], sent: ALL_KINDS });
  });
});
