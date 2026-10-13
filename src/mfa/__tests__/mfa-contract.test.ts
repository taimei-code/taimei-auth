import { describe, expect, test } from "bun:test";
import { Schema } from "effect";

import { ChallengePassed, MfaEnrollment, MfaStatus } from "../mfa-contract";

const decodes = Schema.is(MfaEnrollment);

const valid = {
  totp_uri: "otpauth://totp/x?secret=A",
  enrollment_id: "e1",
  recovery_codes: ["c1"],
};

describe("MFA の登録の応答", () => {
  test.each([
    ["totp_uri が空", { ...valid, totp_uri: "" }],
    ["enrollment_id が空", { ...valid, enrollment_id: "" }],
    ["recovery_codes が空", { ...valid, recovery_codes: [] }],
  ])("%s なら decode に失敗する", (_name, value) => {
    expect(decodes(value)).toBe(false);
  });

  test("どれも空でなければ decode できる", () => {
    expect(decodes(valid)).toBe(true);
  });
});

describe("MFA チャレンジの通過の応答", () => {
  const passes = Schema.is(ChallengePassed);

  test("redirect_url が空なら decode に失敗する (空の遷移先は今の URL に戻る)", () => {
    expect(passes({ redirect_url: "" })).toBe(false);
  });

  test("redirect_url が空でなければ decode できる", () => {
    expect(passes({ redirect_url: "/account" })).toBe(true);
  });
});

describe("MFA の状態の応答", () => {
  test("残りの recovery code の数が有限でなければ decode に失敗する", () => {
    expect(
      Schema.is(MfaStatus)({ enabled: true, recovery_codes_remaining: Number.POSITIVE_INFINITY }),
    ).toBe(false);
  });
});
