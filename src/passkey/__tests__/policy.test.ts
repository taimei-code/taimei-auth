import { expect, test } from "bun:test";
import { isPasskeyLimitReached } from "../policy";

test("パスキーの数の上限は 10 本で達し、同時の登録で超えた 11 本でも達したままになる", () => {
  expect([9, 10, 11].map(isPasskeyLimitReached)).toEqual([false, true, true]);
});
