import { describe, expect, test } from "bun:test";
import { acceptInvitationPath, acceptInvitationSearchSchema } from "../accept-path";

const target = {
  service_name: "taimei",
  redirect_url: "https://app.taimei-code.com/dashboard",
} as const;

describe("acceptInvitationPath", () => {
  test("組なしは invitation_token だけを載せる", () => {
    expect(acceptInvitationPath("inv/+abc")).toBe(
      `/auth/signup/accept-invitation?invitation_token=${encodeURIComponent("inv/+abc")}`,
    );
  });

  test("組ありは service_name と redirect_url も載せる (better-auth の magic-link の verify は callbackURL を 2 回 decode するので、redirect_url の query と fragment は保たれない)", () => {
    const url = new URL(acceptInvitationPath("inv/+abc", target), "http://localhost");

    expect(url.pathname).toBe("/auth/signup/accept-invitation");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      invitation_token: "inv/+abc",
      ...target,
    });
  });

  test("作った URL の search を web の受諾の route の schema で読むと、同じ token と組に戻る", () => {
    const url = new URL(acceptInvitationPath("inv/+abc", target), "http://localhost");

    expect(acceptInvitationSearchSchema.parse(Object.fromEntries(url.searchParams))).toEqual({
      invitation_token: "inv/+abc",
      ...target,
    });
  });
});
