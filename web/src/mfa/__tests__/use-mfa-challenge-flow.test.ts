import { describe, expect, mock, test } from "bun:test";
import { Exit } from "effect";

import { RateLimited } from "@core/failures";
import { ChallengeExpired, InvalidCode, Locked } from "@core/mfa/errors";

import { MFA_FAILURE_MESSAGES } from "../mfa-atom";

import type { MfaChallengeFlowEvent } from "../mfa-challenge-flow";
import { submitVerification, verificationOf } from "../use-mfa-challenge-flow";

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

  test("Locked と RateLimited は、それぞれの MFA の文言の rejected", () => {
    expect(verificationOf(Exit.fail(new Locked()))).toEqual({
      kind: "rejected",
      errorMessage: MFA_FAILURE_MESSAGES.Locked,
    });
    expect(verificationOf(Exit.fail(new RateLimited()))).toEqual({
      kind: "rejected",
      errorMessage: MFA_FAILURE_MESSAGES.RateLimited,
    });
  });

  test("通信や応答の decode の失敗 (defect) は既定の文言の rejected", () => {
    expect(verificationOf(Exit.die(new TypeError("network unavailable")))).toEqual({
      kind: "rejected",
      errorMessage: "処理に失敗しました。しばらく待ってからもう一度お試しください。",
    });
  });
});

describe("submitVerification", () => {
  test("送信の開始を知らせ、verify の結果を verificationOf に通して知らせる", async () => {
    const events: MfaChallengeFlowEvent[] = [];
    const verify = mock(() => Promise.resolve(Exit.fail(new ChallengeExpired())));

    await submitVerification(
      { code: "123456", kind: "totp" },
      { verify, dispatch: (event) => events.push(event) },
    );

    expect(verify).toHaveBeenCalledWith({ code: "123456", kind: "totp" });
    expect(events).toEqual([
      { type: "verification_started" },
      { type: "verification_resolved", verification: { kind: "expired" } },
    ]);
  });
});
