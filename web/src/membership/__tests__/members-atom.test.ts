import { describe, expect, test } from "bun:test";

import { membersOf, pendingInvitationsOf } from "../members-atom";

describe("members atom", () => {
  test("同じ事業所の query atom は同じ値を返す (再描画ごとに取得し直さない)", () => {
    expect(membersOf("co_a")).toBe(membersOf("co_a"));
    expect(pendingInvitationsOf("co_a")).toBe(pendingInvitationsOf("co_a"));
  });

  test("事業所が違えば別の atom (切替前の応答が今の画面に届かない)", () => {
    expect(membersOf("co_a")).not.toBe(membersOf("co_b"));
  });
});
