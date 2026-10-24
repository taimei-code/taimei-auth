import { describe, expect, test } from "bun:test";
import { pageAccountOf } from "../chosen-account";

const account = (lastUsedCompanyId: string | null): Parameters<typeof pageAccountOf>[0] => ({
  id: "user-a",
  name: "利用者 A",
  email: "a@example.com",
  lastUsedCompanyId,
  memberships: [
    {
      role: "OWNER",
      company: { id: "cmp-active", name: "使う事業所", activationStatus: "ACTIVE" },
    },
    {
      role: "ADMIN",
      company: { id: "cmp-deleted", name: "消した事業所", activationStatus: "DELETED" },
    },
  ],
});

describe("画面に渡す利用者は、ACTIVE の事業所だけを持ち、現在の事業所に印を付ける", () => {
  test("ACTIVE でない事業所は渡さない", () => {
    expect(pageAccountOf(account("cmp-active")).companies.map(({ name }) => name)).toEqual([
      "使う事業所",
    ]);
  });

  test("現在の事業所の行だけに印を付ける", () => {
    expect(pageAccountOf(account("cmp-active")).companies).toEqual([
      { id: "cmp-active", name: "使う事業所", role: "OWNER", isCurrent: true },
    ]);
  });

  test("現在の事業所が無い利用者は、どの行にも印を付けない", () => {
    expect(pageAccountOf(account(null)).companies.some(({ isCurrent }) => isCurrent)).toBe(false);
  });
});
