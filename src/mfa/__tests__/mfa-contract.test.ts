import { describe, expect, test } from "bun:test";
import { Schema } from "effect";

import { MfaEnrollment } from "../mfa-contract";

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
