import { expect, test } from "bun:test";

import type { FailureMessages } from "../failure-message";

type Failure =
  | { readonly _tag: "Conflict" }
  | { readonly _tag: "RateLimited" }
  | { readonly _tag: "Unauthorized" };

// @ts-expect-error 契約の失敗の _tag が 1 つでも欠けた表は型エラー
const _missingTag: FailureMessages<Failure> = { Conflict: "競合" };

const _withUnauthorized: FailureMessages<Failure> = {
  Conflict: "競合",
  RateLimited: "回数の上限",
  // @ts-expect-error Unauthorized は表に書かない (共通ログイン画面へ移すのは application の update)
  Unauthorized: "ログインし直す",
};

const complete: FailureMessages<Failure> = { Conflict: "競合", RateLimited: "回数の上限" };

test("失敗の文言の表は Unauthorized を除くすべての _tag を持つ (typecheck で検査する)", () => {
  expect(Object.keys(complete)).toEqual(["Conflict", "RateLimited"]);
});
