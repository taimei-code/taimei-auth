import { expect, test } from "bun:test";
import { mergeForwardedCookies } from "../session-headers";

// gateway.test.ts (削除済み) から移設。入力順保持は「後段 rotate で前段を失わない」契約の核。
test("複数 source の Set-Cookie を入力順で保持する", () => {
  const first = new Headers();
  first.append("set-cookie", "session=first");
  first.append("set-cookie", "challenge=first");
  const second = new Headers();
  second.append("set-cookie", "session=second");

  expect(mergeForwardedCookies(first, second).getSetCookie()).toEqual([
    "session=first",
    "challenge=first",
    "session=second",
  ]);
});
