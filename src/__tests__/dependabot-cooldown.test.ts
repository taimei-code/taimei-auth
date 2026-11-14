import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./config-invariant-helpers";

const SECONDS_PER_DAY = 86_400;

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const readUpdates = () =>
  (
    Bun.YAML.parse(read(".github/dependabot.yml")) as {
      updates: { "package-ecosystem": string; cooldown?: unknown }[];
    }
  ).updates;

const readMinimumReleaseAge = () =>
  (Bun.TOML.parse(read("bunfig.toml")) as { install: { minimumReleaseAge: number } }).install
    .minimumReleaseAge;

describe("Dependabot の cooldown invariant", () => {
  test("bun の cooldown は、bunfig.toml の minimumReleaseAge と同じ日数だけを持つ (ADR-0009)", () => {
    const bunCooldowns = readUpdates()
      .filter((update) => update["package-ecosystem"] === "bun")
      .map(({ cooldown }) => cooldown);

    expect(bunCooldowns.length).toBeGreaterThan(0);
    expect(bunCooldowns).toEqual(
      bunCooldowns.map(() => ({ "default-days": readMinimumReleaseAge() / SECONDS_PER_DAY })),
    );
  });

  test("minimumReleaseAge は 7 日である。悪性の版は公開から 7 日以内に yank されてきた (ADR-0009)", () => {
    expect(readMinimumReleaseAge()).toBe(7 * SECONDS_PER_DAY);
  });

  test("npm の update を置かない。Dependabot の npm は package.json だけを変え、bun.lock を変えないので、CI の frozen-lockfile の install を通らない (ADR-0009)", () => {
    expect(readUpdates().map((update) => update["package-ecosystem"])).not.toContain("npm");
  });
});
