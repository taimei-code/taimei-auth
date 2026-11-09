import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { REPO_ROOT } from "../../__tests__/source-scan";
import { parsePrimaryAuthRoute } from "../primary-auth-routes";

describe("auth-plugins の判定の封じ込め (静的 tripwire)", () => {
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
