import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { grepFiles, REPO_ROOT } from "../../__tests__/grep-files";
import { parsePrimaryAuthRoute } from "../primary-auth-routes";

describe("auth-plugins の判定の封じ込め (静的 tripwire)", () => {
  test("一次認証 route と provider の literal 比較は primary-auth-routes.ts だけ (parser 1 本に集約)", () => {
    expect(
      grepFiles('"github"|"/callback/:id"|"/magic-link/verify"', "src/auth-plugins", {
        excludeTests: true,
      }),
    ).toEqual(["src/auth-plugins/primary-auth-routes.ts"]);
  });

  test("auth.ts に登録しうる socialProviders は全て parser が Mapped にする (未知 provider の無言 skip を防ぐ)", async () => {
    const source = await Bun.file(resolve(REPO_ROOT, "src/auth.ts")).text();
    const start = source.indexOf("socialProviders: {");
    const block = source.slice(start, source.indexOf("\n    },\n", start));
    const providerIds = [...block.matchAll(/^\s+(\w+): \{$/gm)].map((m) => m[1]);
    expect(providerIds).toContain("github");
    for (const id of providerIds) {
      expect(parsePrimaryAuthRoute("/callback/:id", { id })._tag).toBe("Mapped");
    }
  });
});
