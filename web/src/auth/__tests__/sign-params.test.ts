import { afterEach, describe, expect, test } from "bun:test";
import { buildSignParams, invitationAcceptCallbackUrl } from "../sign-params";

describe("buildSignParams", () => {
  test("allowlist キー (service_name / redirect_url / sign_up_url) を保持する", () => {
    const input = new URLSearchParams({
      service_name: "accounts",
      redirect_url: "http://auth.taimei-code.local:3100/account",
      sign_up_url: "http://auth.taimei-code.local:3100/signup",
    });

    const out = new URLSearchParams(buildSignParams(input));
    expect(out.get("service_name")).toBe("accounts");
    expect(out.get("redirect_url")).toBe("http://auth.taimei-code.local:3100/account");
    expect(out.get("sign_up_url")).toBe("http://auth.taimei-code.local:3100/signup");
  });

  test("allowlist 外キー (error 等の stale state) を落とす", () => {
    const input = new URLSearchParams({
      service_name: "accounts",
      redirect_url: "http://localhost/account",
      error: "signin_failed",
      utm_source: "mail",
    });

    const out = new URLSearchParams(buildSignParams(input));
    expect(out.has("error")).toBe(false);
    expect(out.has("utm_source")).toBe(false);
    expect(out.get("service_name")).toBe("accounts");
  });

  test("invitation_token を保持する (SignIn/SignUp 相互リンクで招待受諾フローから脱落させない)", () => {
    const input = new URLSearchParams({
      service_name: "accounts",
      redirect_url: "http://localhost/account",
      invitation_token: "inv-abc",
    });

    expect(new URLSearchParams(buildSignParams(input)).get("invitation_token")).toBe("inv-abc");
  });

  test("同名キー重複時は最初の値を採用する (server 側 Object.fromEntries は最後を採る非対称の pin)", () => {
    const input = new URLSearchParams(
      "service_name=accounts&redirect_url=http://first.example/&redirect_url=http://second.example/",
    );

    expect(new URLSearchParams(buildSignParams(input)).get("redirect_url")).toBe(
      "http://first.example/",
    );
  });

  test("欠落キーは出力にも現れない", () => {
    const input = new URLSearchParams({ service_name: "accounts" });
    const out = new URLSearchParams(buildSignParams(input));
    expect(out.has("redirect_url")).toBe(false);
    expect(out.toString()).toBe("service_name=accounts");
  });
});

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
