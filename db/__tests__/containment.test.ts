import { describe, expect, test } from "bun:test";
import { grepFiles, SOURCE_ROOTS } from "../../src/__tests__/source-scan";

const hitsOf = (pattern: string): string[] =>
  SOURCE_ROOTS.flatMap((root) => grepFiles(pattern, root));

describe("DATABASE_URL の向き先の判定は databaseTarget に閉じる", () => {
  test("local の host の集合で判定するのは db/testing/local-database.ts だけ", () => {
    expect(hitsOf("LOCAL_DATABASE_HOSTNAMES\\.has\\(")).toEqual(["db/testing/local-database.ts"]);
  });

  test("DATABASE_URL を URL として読む file は無い", () => {
    expect(hitsOf("new URL\\(process\\.env\\.DATABASE_URL")).toEqual([]);
  });
});
