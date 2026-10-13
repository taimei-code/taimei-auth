import { describe, expect, test } from "bun:test";
import { Exit } from "effect";

import { ChallengeExpired, InvalidCode } from "@core/mfa/errors";

import { verificationOf } from "../use-mfa-challenge-flow";

describe("verificationOf", () => {
  test("verify の成功は redirect_url を redirectUrl にした passed", () => {
    expect(verificationOf(Exit.succeed({ redirect_url: "/account/security" }))).toEqual({
      kind: "passed",
      redirectUrl: "/account/security",
    });
  });

  test("ChallengeExpired は入力を閉じる expired", () => {
    expect(verificationOf(Exit.fail(new ChallengeExpired()))).toEqual({ kind: "expired" });
  });

  test("宣言した他の失敗は、その文言の rejected", () => {
    expect(verificationOf(Exit.fail(new InvalidCode()))).toEqual({
      kind: "rejected",
      errorMessage: "入力されたコードが正しくありません。",
    });
  });

  test("通信や応答の decode の失敗 (defect) は既定の文言の rejected", () => {
    expect(verificationOf(Exit.die(new TypeError("network unavailable")))).toEqual({
      kind: "rejected",
      errorMessage: "処理に失敗しました。しばらく待ってからもう一度お試しください。",
    });
  });
});
