import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { Result, type SessionData, type VerifyResult } from "../../src/index";

describe("VerifyResult discriminated union", () => {
  test("narrows to data when ok=true", () => {
    const result: VerifyResult = {
      ok: true,
      data: {
        user: {
          id: "u1",
          name: "n",
          email: "e",
          emailVerified: true,
          createdAt: "",
          updatedAt: "",
        },
        session: { id: "s1", expiresAt: "", kind: "user" },
      },
    };
    if (!result.ok) throw new Error("should have narrowed to ok branch");
    const data: SessionData = result.data;
    expect(data.user.id).toBe("u1");
  });

  test("narrows to reason when ok=false", () => {
    const result: VerifyResult = { ok: false, reason: Result.REVISION_OUTDATED };
    if (result.ok) throw new Error("should have narrowed to error branch");
    expect(result.reason).toBe(Result.REVISION_OUTDATED);
  });
});

describe("MECE C5 / N4: brand types are not leaked to consumers", () => {
  test("all dist/**/*.d.ts files do not contain brand type names", () => {
    const distDir = join(import.meta.dir, "..", "..", "dist");
    if (!existsSync(distDir)) {
      throw new Error("dist/ not found. Run `bun run build` before tests.");
    }
    const files = execSync(`find ${distDir} -name '*.d.ts'`, { encoding: "utf-8" })
      .split("\n")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    const forbidden = ["ExternalToken", "InternalSession", "asExternalToken", "asInternalSession"];
    for (const file of files) {
      const dts = readFileSync(file, "utf-8");
      for (const name of forbidden) {
        if (dts.includes(name)) {
          throw new Error(`brand type "${name}" leaked into ${file}`);
        }
      }
    }
  });
});
