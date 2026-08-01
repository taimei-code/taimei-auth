import { describe, expect, test } from "bun:test";
import { buildSignParams } from "../sign-params";

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

  test("invitation_token も落ちる (現状仕様の pin — SignIn/SignUp 相互リンクで token が消える点は既知の懸念)", () => {
    const input = new URLSearchParams({
      service_name: "accounts",
      redirect_url: "http://localhost/account",
      invitation_token: "inv-abc",
    });

    expect(new URLSearchParams(buildSignParams(input)).has("invitation_token")).toBe(false);
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
