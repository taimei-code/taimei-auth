import { describe, expect, test } from "bun:test";
import { grepFiles } from "../../__tests__/grep-files";

describe("退会の判定は deleteAccountUnlessLastOwner だけが持つ", () => {
  test("sole OWNER の検査と OWNER 行の lock を呼ぶ production file は delete-account.ts だけ", () => {
    expect(
      grepFiles(
        "(findCompaniesBlockingUserDeletion|lockOwnerMembershipsOfUserCompanies)\\(",
        "src",
        {
          excludeTests: true,
        },
      ),
    ).toEqual(["src/account/delete-account.ts"]);
  });

  test("account を削除する deleteAccount を呼ぶ production file は delete-account.ts と orphan.ts だけ", () => {
    expect(grepFiles("deleteAccount\\(", "src", { excludeTests: true }).sort()).toEqual([
      "src/account/delete-account.ts",
      "src/account/orphan.ts",
    ]);
    expect(grepFiles("\\.deleteUser\\(", "src", { excludeTests: true })).toEqual([
      "src/account/delete-account.ts",
    ]);
  });

  test("membership の OWNER 行の lock は全て id 順に取る (順序が違うと退会と他の OWNER 変更が deadlock する)", () => {
    const lockLines = grepFiles("FOR UPDATE", "db/repositories/membership.ts", { lines: true });
    expect(lockLines.length).toBeGreaterThanOrEqual(2);
    expect(lockLines.filter((line) => !line.includes("ORDER BY id FOR UPDATE"))).toEqual([]);
  });

  test("better-auth の退会 endpoint を有効にしない", () => {
    expect(grepFiles("deleteUser:", "src/auth.ts")).toEqual([]);
  });
});
