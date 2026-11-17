import { describe, expect, test } from "bun:test";
import { readRepoText } from "./harness/repo-text";

const SEVEN_DAYS_IN_SECONDS = 7 * 86_400;

describe("依存の追加の守り", () => {
  test("lifecycle script を許す依存は無く、公開から 7 日の待ちは緩めず、検証の library を待ちの例外にしていない", () => {
    const manifest: { trustedDependencies?: unknown } = JSON.parse(
      readRepoText("package.json"),
    );
    expect(manifest.trustedDependencies).toEqual([]);

    const bunfig = Bun.TOML.parse(readRepoText("bunfig.toml")) as {
      install?: { minimumReleaseAge?: number; minimumReleaseAgeExcludes?: readonly string[] };
    };
    expect(bunfig.install?.minimumReleaseAge).toBe(SEVEN_DAYS_IN_SECONDS);
    expect(bunfig.install?.minimumReleaseAgeExcludes ?? []).not.toContain("@simplewebauthn/server");
  });
});
