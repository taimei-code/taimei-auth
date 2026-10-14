import { describe, expect, test } from "bun:test";
import { buildTotpUri, generateTotpSecret } from "../totp-engine";

describe("totp-engine", () => {
  test("period・digits・algorithm は固定 (変えると登録済みの全員が認証アプリを登録し直す)", () => {
    const uri = new URL(
      buildTotpUri({
        issuer: "taimei",
        accountLabel: "a@example.com",
        secret: generateTotpSecret(),
      }),
    );
    expect(uri.searchParams.get("period")).toBe("30");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
  });

  test("secret は ASCII 英数字だけ (生のバイト乱数は base32 と文字列の往復で UTF-8 として壊れる)", () => {
    const secret = new TextDecoder().decode(generateTotpSecret());
    expect(secret).toMatch(/^[A-Za-z0-9]{32}$/);
  });
});
