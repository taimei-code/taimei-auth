import { describe, expect, test } from "bun:test";
import { Exit } from "effect";
import { AtomRegistry } from "effect/reactivity";

import type { CompanyState } from "@core/account/account-contract";
import { Unauthorized } from "@core/failures";

import { companySignupEntryOf, readCompanySignupEntry } from "../company-signup-entry";

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

const REDIRECT_URL = "https://app.taimei-code.com/dashboard";

describe("companySignupEntryOf", () => {
  test("session が無ければ sign-in へ", () => {
    expect(companySignupEntryOf({ hasSession: false })).toEqual({ kind: "signIn" });
  });

  test("所属が 1 件以上あれば redirect_url へ", () => {
    expect(
      companySignupEntryOf({
        hasSession: true,
        companyState: Exit.succeed(stateWith(1)),
        redirectUrl: REDIRECT_URL,
      }),
    ).toEqual({ kind: "goToRedirectUrl", redirectUrl: REDIRECT_URL });
  });

  test("所属が 0 件なら form を出す", () => {
    expect(
      companySignupEntryOf({
        hasSession: true,
        companyState: Exit.succeed(stateWith(0)),
        redirectUrl: REDIRECT_URL,
      }),
    ).toEqual({ kind: "show" });
  });

  test("事業所状態の取得が Unauthorized なら form を出す (ログイン画面へ移すのは SPA の API の client)", () => {
    expect(
      companySignupEntryOf({
        hasSession: true,
        companyState: Exit.fail(new Unauthorized()),
        redirectUrl: REDIRECT_URL,
      }),
    ).toEqual({ kind: "show" });
  });

  test("事業所状態の取得が通信で失敗したら form を出す", () => {
    expect(
      companySignupEntryOf({
        hasSession: true,
        companyState: Exit.die(new Error("network")),
        redirectUrl: REDIRECT_URL,
      }),
    ).toEqual({ kind: "show" });
  });
});

describe("readCompanySignupEntry", () => {
  test("session の確認が reject したら form を出す (事業所の作成を止めない)", async () => {
    const entry = await readCompanySignupEntry(
      AtomRegistry.make(),
      new AbortController().signal,
      REDIRECT_URL,
      () => Promise.reject(new Error("network")),
    );

    expect(entry).toEqual({ kind: "show" });
  });
});
