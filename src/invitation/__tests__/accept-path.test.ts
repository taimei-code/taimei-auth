import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { AcceptInvitationSearch, acceptInvitationPath } from "../accept-path";

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

  test("組ありは service_name と redirect_url も載せる", () => {
    const url = new URL(acceptInvitationPath("inv/+abc", target), "http://localhost");

    expect(url.pathname).toBe("/auth/signup/accept-invitation");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      invitation_token: "inv/+abc",
      ...target,
    });
  });

  test("作った URL の search を web の受諾の route の schema で読むと、同じ token と組に戻る", () => {
    const url = new URL(acceptInvitationPath("inv/+abc", target), "http://localhost");

    expect(Schema.decodeSync(AcceptInvitationSearch)(Object.fromEntries(url.searchParams))).toEqual(
      {
        invitation_token: "inv/+abc",
        ...target,
      },
    );
  });
});
