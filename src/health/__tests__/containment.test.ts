import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grepFiles, REPO_ROOT } from "../../__tests__/source-scan";

describe("/health probe の封じ込め (静的 tripwire)", () => {
  test("health の repository は void で返す", () => {
    expect(grepFiles("Promise<void>", "db/repositories/health.ts")).toHaveLength(1);
  });

  test("TtlStore.ping は attemptOnce (retry なし、ADR-0017)", () => {
    expect(
      readFileSync(join(REPO_ROOT, "src/ttl-store-service.ts"), "utf8").match(
        /\bping:\s*\(\)\s*=>\s*attemptOnce\(/g,
      ),
    ).toHaveLength(1);
  });

  test("app.ts は handlers/health を mountStatic より前に route する", () => {
    const app = readFileSync(join(REPO_ROOT, "src/app.ts"), "utf8");
    expect(app.indexOf('app.route("/", health)')).toBeGreaterThan(-1);
    expect(app.indexOf('app.route("/", health)')).toBeLessThan(
      app.indexOf("options.mountStatic(app)"),
    );
  });

  test("handlers/health.ts は runRoute で走らせる", () => {
    expect(grepFiles("runRoute\\(", "src/handlers/health.ts")).toHaveLength(1);
  });
});
