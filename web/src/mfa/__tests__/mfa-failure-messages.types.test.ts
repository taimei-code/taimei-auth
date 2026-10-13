import { expect, test } from "bun:test";

import { MFA_FAILURE_MESSAGES } from "../mfa-atom";

const { RateLimited: _dropped, ...withoutRateLimited } = MFA_FAILURE_MESSAGES;
// @ts-expect-error 契約が宣言する失敗の _tag が 1 つでも欠けた表は型エラー
const _incomplete: typeof MFA_FAILURE_MESSAGES = withoutRateLimited;

test("MFA の文言の表は契約の失敗をすべて持つ (typecheck で検査する)", () => {
  expect(Object.keys(MFA_FAILURE_MESSAGES)).toContain("RateLimited");
});
