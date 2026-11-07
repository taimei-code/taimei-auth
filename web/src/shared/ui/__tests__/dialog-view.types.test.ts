import { expect, test } from "bun:test";

import type { DialogContent } from "../dialog-view";

test("house の dialog は、呼び手から表示の class を受け取らない", () => {
  const content: DialogContent = {
    title: "多要素認証 (MFA) を有効にする",
    description: "認証アプリを登録します。",
    body: [],
    isClosingBlocked: false,
    // @ts-expect-error 表示の class は dialogView の内側にだけ置く
    className: "grid",
  };
  expect(content.title).toBe("多要素認証 (MFA) を有効にする");
});
