import { describe, expect, test } from "bun:test";
import { grepFiles, grepLines } from "../../__tests__/source-scan";

describe("退会の判定は deleteAccountUnlessLastOwner だけが持つ", () => {
  test("sole OWNER の検査と OWNER 行の lock を呼ぶ production file は delete-account.ts だけ", () => {
    expect(
      grepFiles(
        "(findCompaniesBlockingUserDeletion|lockOwnerMembershipsOfUserCompanies)\\(",
        "src",
        {
          tests: "exclude",
        },
      ),
    ).toEqual(["src/account/delete-account.ts"]);
  });

  test("account を削除する deleteAccount を呼ぶ production file は delete-account.ts と orphan.ts だけ", () => {
    expect(grepFiles("deleteAccount\\(", "src", { tests: "exclude" }).sort()).toEqual([
      "src/account/delete-account.ts",
      "src/account/orphan.ts",
    ]);
    expect(grepFiles("\\.deleteUser\\(", "src", { tests: "exclude" })).toEqual([
      "src/account/delete-account.ts",
    ]);
  });

  test("membership の OWNER 行の lock は全て id 順に取る (順序が違うと退会と他の OWNER 変更が deadlock する)", () => {
    const lockLines = grepLines("FOR UPDATE", "db/repositories/membership.ts", {});
    expect(lockLines.length).toBeGreaterThanOrEqual(1);
    expect(lockLines.filter((line) => !line.includes("ORDER BY id FOR UPDATE"))).toEqual([]);
  });

  test("better-auth の退会 endpoint を有効にしない", () => {
    expect(grepFiles("deleteUser:", "src/auth.ts")).toEqual([]);
  });
});

describe("TTL store の session 削除は commit 後の deleteSessionsOf だけが行う", () => {
  test("AuthApi の実装 (auth-wiring.ts) の外で deleteUserSessions を呼ぶ production file は delete-sessions.ts だけ (tx の中から呼ばせない)", () => {
    expect(grepFiles("\\.deleteUserSessions\\(", "src", { tests: "exclude" }).sort()).toEqual([
      "src/account/delete-sessions.ts",
      "src/auth-wiring.ts",
    ]);
  });

  test("TTL store の session を消す deleteSessionsOf を呼ぶのは deleteAccount だけ (commit 後の後始末として登録する)", () => {
    expect(grepFiles("deleteSessionsOf\\(", "src", { tests: "exclude" })).toEqual([
      "src/account/delete-account.ts",
    ]);
  });
});
