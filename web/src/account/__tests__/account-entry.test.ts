import { describe, expect, test } from "bun:test";
import { Exit } from "effect";

import type { CompanyState } from "@core/account/account-contract";
import { Unauthorized } from "@core/membership/guard/errors";

import { accountEntryOf } from "../account-entry";

const stateWith = (count: number): CompanyState => ({
  current_company_id: count > 0 ? "company-0" : null,
  memberships: Array.from({ length: count }, (_, i) => ({
    id: `membership-${i}`,
    company_id: `company-${i}`,
    company_name: `Example ${i}`,
    company_org_code: "PERSONAL",
    role: "OWNER" as const,
    joined_at: "2026-10-11T00:00:00Z",
  })),
});

describe("accountEntryOf", () => {
  test("事業所状態の取得が Unauthorized ならログイン画面へ", () => {
    expect(accountEntryOf(Exit.fail(new Unauthorized()))).toEqual({ kind: "signIn" });
  });

  test("所属が 0 件なら事業所登録へ", () => {
    expect(accountEntryOf(Exit.succeed(stateWith(0)))).toEqual({ kind: "companySignup" });
  });

  test("所属が 1 件以上なら画面を出す", () => {
    expect(accountEntryOf(Exit.succeed(stateWith(1)))).toEqual({ kind: "show" });
  });

  test("Unauthorized 以外の失敗は画面を出す (各画面が読み込みの失敗を出す)", () => {
    expect(accountEntryOf(Exit.die(new Error("network")))).toEqual({ kind: "show" });
  });
});
