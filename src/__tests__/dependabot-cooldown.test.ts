import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./config-invariant-helpers";

const SECONDS_PER_DAY = 86_400;

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

describe("Dependabot の cooldown invariant", () => {
  test("npm の cooldown は、bunfig.toml の minimumReleaseAge と同じ日数だけを持つ (ADR-0009)", () => {
    const { install } = Bun.TOML.parse(read("bunfig.toml")) as {
      install: { minimumReleaseAge: number };
    };
    const { updates } = Bun.YAML.parse(read(".github/dependabot.yml")) as {
      updates: { "package-ecosystem": string; cooldown?: unknown }[];
    };
    const npmCooldowns = updates
      .filter((update) => update["package-ecosystem"] === "npm")
      .map(({ cooldown }) => cooldown);

    expect(npmCooldowns.length).toBeGreaterThan(0);
    expect(npmCooldowns).toEqual(
      npmCooldowns.map(() => ({ "default-days": install.minimumReleaseAge / SECONDS_PER_DAY })),
    );
  });
});
