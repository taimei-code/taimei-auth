import { describe, expect, test } from "bun:test";

import { membersOf } from "../membership-atom";

describe("membersOf", () => {
  test("同じ事業所なら同じ atom を返す (描画のたびに取り直さない)", () => {
    expect(membersOf("co_a")).toBe(membersOf("co_a"));
  });

  test("事業所が違えば別の atom を返す (切替前の応答が今の画面に入らない)", () => {
    expect(membersOf("co_a")).not.toBe(membersOf("co_b"));
  });
});
