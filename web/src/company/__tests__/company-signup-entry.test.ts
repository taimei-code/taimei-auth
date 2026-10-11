import { describe, expect, test } from "bun:test";
import { Exit } from "effect";

import type { CompanyState } from "@core/account/account-contract";
import { Unauthorized } from "@core/membership/guard/errors";

import { companySignupEntryOf } from "../company-signup-entry";

const stateWith = (count: number): CompanyState => ({
  current_company_id: count > 0 ? "company-1" : null,
  memberships: Array.from({ length: count }, (_, i) => ({
    id: `membership-${i}`,
    company_id: `company-${i}`,
    company_name: `Example ${i}`,
    company_org_code: "PERSONAL",
    role: "OWNER" as const,
    joined_at: "2026-10-11T00:00:00Z",
  })),
});

describe("companySignupEntryOf", () => {
  test("session が無ければ sign-in へ", () => {
    expect(companySignupEntryOf({ hasSession: false })).toEqual({ kind: "signIn" });
  });

  test("所属が 1 件以上あれば redirect_url へ", () => {
    expect(
      companySignupEntryOf({ hasSession: true, companyState: Exit.succeed(stateWith(1)) }),
    ).toEqual({ kind: "goToRedirectUrl" });
  });

  test("所属が 0 件なら form を出す", () => {
    expect(
      companySignupEntryOf({ hasSession: true, companyState: Exit.succeed(stateWith(0)) }),
    ).toEqual({ kind: "form" });
  });

  test("事業所状態の取得が Unauthorized なら stale session を捨てる", () => {
    expect(
      companySignupEntryOf({ hasSession: true, companyState: Exit.fail(new Unauthorized()) }),
    ).toEqual({ kind: "discardStaleSession" });
  });

  test("事業所状態の取得が Unauthorized 以外で失敗したら form を出す", () => {
    expect(
      companySignupEntryOf({ hasSession: true, companyState: Exit.die(new Error("network")) }),
    ).toEqual({ kind: "form" });
  });
});
