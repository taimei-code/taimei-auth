import { expect, test } from "bun:test";

import { PASSKEY_FAILURE_MESSAGES } from "../passkey-failure-messages";

const { TotpRequired: _dropped, ...withoutTotpRequired } = PASSKEY_FAILURE_MESSAGES;
// @ts-expect-error 契約が宣言する失敗の _tag が 1 つでも欠けた表は型エラー
const _incomplete: typeof PASSKEY_FAILURE_MESSAGES = withoutTotpRequired;

test("パスキーの文言の表は契約の失敗をすべて持つ (typecheck で検査する)", () => {
  expect(Object.keys(PASSKEY_FAILURE_MESSAGES)).toContain("TotpRequired");
});
