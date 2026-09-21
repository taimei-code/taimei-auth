import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grepFiles, REPO_ROOT } from "../../__tests__/grep-files";

describe("/health probe の封じ込め (静的 tripwire)", () => {
  test("probe の呼び手は src/health/probe.ts だけ", () => {
    expect(grepFiles("\\.pingDatabase\\(|\\.ping\\(", "src", { excludeTests: true })).toEqual([
      "src/health/probe.ts",
    ]);
  });

  test("repository と driver は失敗を握らず void で返す", () => {
    expect(grepFiles("Promise<void>", "db/repositories/health.ts")).toHaveLength(1);
    expect(grepFiles("catch", "db/repositories/health.ts")).toEqual([]);
    expect(grepFiles("catch", "src/ttl-store.ts")).toEqual([]);
  });

  test("TtlStore.ping は attemptOnce (retry なし、ADR-0017)", () => {
    expect(
      grepFiles("ping: \\(\\) => attemptOnce\\(", "src/ttl-store-service.ts", { lines: true }),
    ).toHaveLength(1);
  });

  test("app.ts は handlers/health を mountStatic より前に route し、probe service を直接触らない", () => {
    const app = readFileSync(join(REPO_ROOT, "src/app.ts"), "utf8");
    expect(app).not.toContain('app.get("/health"');
    expect(app.indexOf('app.route("/", health)')).toBeGreaterThan(-1);
    expect(app.indexOf('app.route("/", health)')).toBeLessThan(
      app.indexOf("options.mountStatic(app)"),
    );
    expect(grepFiles('from "\\./(health/ports|ttl-store-service)"', "src/app.ts")).toEqual([]);
  });

  test("handlers/health.ts は runRoute で走らせ runtime を直接呼ばない", () => {
    expect(grepFiles("runRoute\\(", "src/handlers/health.ts")).toHaveLength(1);
    expect(grepFiles("Effect\\.runPromise|getRuntime\\(", "src/handlers/health.ts")).toEqual([]);
  });
});
