import { describe, expect, test } from "bun:test";
import { acceptInvitationPath } from "../accept-path";

describe("acceptInvitationPath", () => {
  test("AC-008 組なしは invitation_token だけを載せる", () => {
    expect(acceptInvitationPath("inv/+abc")).toBe(
      `/auth/signup/accept-invitation?invitation_token=${encodeURIComponent("inv/+abc")}`,
    );
  });

  test("AC-009 組ありは service_name と redirect_url も載せる", () => {
    const url = new URL(
      acceptInvitationPath("inv/+abc", {
        service_name: "taimei",
        redirect_url: "https://app.taimei-code.com/dashboard",
      }),
      "http://localhost",
    );

    expect(url.pathname).toBe("/auth/signup/accept-invitation");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      invitation_token: "inv/+abc",
      service_name: "taimei",
      redirect_url: "https://app.taimei-code.com/dashboard",
    });
  });
});
