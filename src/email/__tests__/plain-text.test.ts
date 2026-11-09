import { describe, expect, test } from "bun:test";
import { invitationEmail } from "../invitation";
import { renderEmail } from "../layout";
import { toDisplayText } from "../sanitize";
import { welcomeEmail } from "../welcome";

describe("メールの plain text", () => {
  test("利用者の入力の中の連続した空白は、移す前の html-to-text と同じく 1 つの空白にする", () => {
    const { text } = renderEmail(
      invitationEmail({
        url: "https://auth.example.com/invite",
        appName: "taimei",
        companyName: toDisplayText("株式会社  テスト"),
        inviterName: toDisplayText("Alice   Bob"),
        inviterEmail: toDisplayText("alice@example.com"),
        inviteeEmail: "invitee@example.com",
        roleLabel: "メンバー",
        supportEmail: "support@example.com",
        abuseUrl: "https://example.com/security",
      }),
      2026,
    );
    expect(text).toContain("Alice Bob さん (alice@example.com) から");
    expect(text).toContain("「株式会社 テスト」への参加");
  });

  test("見出しに入る表示名の連続した空白も 1 つの空白にする", () => {
    const { text } = renderEmail(
      welcomeEmail({
        appName: "taimei",
        userName: toDisplayText("Alice   Bob"),
        dashboardUrl: "https://auth.example.com/dashboard",
      }),
      2026,
    );
    expect(text.startsWith("ようこそ、ALICE BOB さん\n")).toBe(true);
  });
});
