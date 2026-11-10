import { expect, test } from "bun:test";

import { Dialog } from "../ui/dialog-view";

// @ts-expect-error isAnimated は house の Dialog.init が固定し、呼び手は渡せない
const _unanimated = Dialog.init({ id: "dialog", isAnimated: false });

test("house の Dialog.init が作る dialog は、開閉の animation を持つ (渡せないことは typecheck で検査する)", () => {
  expect(Dialog.init({ id: "dialog" }).isAnimated).toBe(true);
});
