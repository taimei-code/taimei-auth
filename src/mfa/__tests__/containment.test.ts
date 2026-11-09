import { describe, expect, test } from "bun:test";
import { grepFiles } from "../../__tests__/source-scan";

describe("MFA totp module boundary", () => {
  test("AuthApi.issueSession の session cookie は、発行する 2 つの file とも hono の serialize で組む (session cookie の契約)", () => {
    expect(
      grepFiles("hono/utils/cookie", ["src/mfa", "src/auth-wiring.ts"], {
        tests: "exclude",
      }).sort(),
    ).toEqual(["src/auth-wiring.ts", "src/mfa/totp/login-challenge.ts"]);
  });

  test("façade が実行時に export する関数 (handler が使ってよいもの) は決まっている", async () => {
    const facade = await import("../totp");
    expect(Object.keys(facade).sort()).toEqual([
      "activate",
      "completeLoginChallenge",
      "disable",
      "enroll",
      "readLoginChallengeState",
      "readOwnedMfaStatus",
    ]);
  });
});
