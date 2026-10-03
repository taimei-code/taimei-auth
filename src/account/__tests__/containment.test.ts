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

describe("TTL store の session 削除は commit 後の deleteSessionsOf だけが行う", () => {
  test("AuthApi の実装 (auth-wiring.ts) の外で deleteUserSessions を呼ぶ production file は delete-sessions.ts だけ (tx の中から呼ばせない)", () => {
    expect(grepFiles("\\.deleteUserSessions\\(", "src", { excludeTests: true }).sort()).toEqual([
      "src/account/delete-sessions.ts",
      "src/auth-wiring.ts",
    ]);
  });

  test("deleteAccountIfOrphaned を呼ぶ production file は全て deleteSessionsOf も呼ぶ", () => {
    const orphanCallers = grepFiles("deleteAccountIfOrphaned\\(", "src", { excludeTests: true })
      .filter((file) => file !== "src/account/orphan.ts")
      .sort();
    expect(orphanCallers.length).toBeGreaterThanOrEqual(3);
    expect(grepFiles("deleteSessionsOf\\(", "src", { excludeTests: true })).toEqual(
      expect.arrayContaining(orphanCallers),
    );
  });
});
