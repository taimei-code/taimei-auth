import { describe, expect, test } from "bun:test";
import { Exit } from "effect";

import { ChallengeExpired, InvalidCode } from "@core/mfa/error-mapping";

import { verificationOf } from "../use-mfa-challenge-flow";

describe("verificationOf", () => {
  test("AC-005 verify の成功は redirect_url を redirectUrl にした passed", () => {
    expect(verificationOf(Exit.succeed({ redirect_url: "/account/security" }))).toEqual({
      kind: "passed",
      redirectUrl: "/account/security",
    });
  });

  test("ChallengeExpired は入力を閉じる expired", () => {
    expect(verificationOf(Exit.fail(new ChallengeExpired()))).toEqual({ kind: "expired" });
  });

  test("宣言した他の失敗は同じ code の rejected", () => {
    expect(verificationOf(Exit.fail(new InvalidCode()))).toEqual({
      kind: "rejected",
      errorCode: "invalid_code",
    });
  });

  test("AC-012 通信や応答の decode の失敗 (defect) は unknown の rejected", () => {
    expect(verificationOf(Exit.die(new TypeError("network unavailable")))).toEqual({
      kind: "rejected",
      errorCode: "unknown",
    });
  });
});
