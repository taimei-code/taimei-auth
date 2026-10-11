import { afterEach, describe, expect, test } from "bun:test";
import { invitationAcceptCallbackUrl, declaredSignInParams } from "../sign-params";

describe("invitationAcceptCallbackUrl", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  test("origin 起点の accept-invitation URL に token を encode して載せる", () => {
    globalThis.window = {
      location: { origin: "http://auth.taimei-code.local:3100" },
    } as unknown as typeof globalThis.window;

    expect(invitationAcceptCallbackUrl("inv/+abc")).toBe(
      "http://auth.taimei-code.local:3100/auth/signup/accept-invitation?invitation_token=inv%2F%2Babc",
    );
  });
});

describe("declaredSignInParams", () => {
  test("search に残る宣言していない key (error 等の古い状態) を相互リンクに引き継がない", () => {
    const search = {
      service_name: "accounts" as const,
      redirect_url: "http://auth.taimei-code.local:3100/account",
      error: "signin_failed",
    };

    expect(declaredSignInParams(search)).toEqual({
      service_name: "accounts",
      redirect_url: "http://auth.taimei-code.local:3100/account",
      sign_up_url: undefined,
      invitation_token: undefined,
    });
  });
});
