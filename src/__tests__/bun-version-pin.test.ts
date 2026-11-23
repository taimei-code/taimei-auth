import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  REPO_ROOT,
  bunVersionPinsInRepo,
  bunVersionPinViolations,
  dockerBunPins,
  setupBunPins,
} from "./config-invariant-helpers";

const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6";

const workflowPinning = (version: string | undefined) =>
  setupBunPins(
    `jobs:\n  check:\n    steps:\n      - uses: ${SETUP_BUN}\n${version === undefined ? "" : `        with:\n          bun-version: "${version}"\n`}`,
    "fixture.yml",
  );

describe("Bun の版の固定", () => {
  test("Dockerfile と GitHub Actions の workflow と action は、同じ Bun の版を固定している", () => {
    const pins = bunVersionPinsInRepo();
    expect(pins.map((pin) => pin.place)).toEqual(
      expect.arrayContaining(["Dockerfile", ".github/actions/prepare-staging/action.yml"]),
    );
    expect(bunVersionPinViolations(pins)).toEqual([]);
  });

  test("手元で test を流す Bun は、repo が固定した版である", () => {
    const [pinned] = dockerBunPins(readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8"));
    expect(typeof pinned?.version).toBe("string");
    expect(`${Bun.version}.`).toStartWith(`${String(pinned?.version)}.`);
  });

  test("1 か所だけ版を上げると、版が分かれていると止める", () => {
    const violations = bunVersionPinViolations([
      ...dockerBunPins("FROM --platform=linux/amd64 oven/bun:1.3 AS base # 本番 image\n"),
      ...workflowPinning("1.4"),
    ]);
    expect(violations.join("\n")).toContain("Bun の版が場所によって分かれている");
  });

  test("bun-version を書かない setup-bun は、版を固定していないと止める", () => {
    expect(bunVersionPinViolations(workflowPinning(undefined))).toEqual([
      "fixture.yml: setup-bun が bun-version を固定していない",
    ]);
  });

  test("引用符で囲まない bun-version は、YAML が数として読むので止める", () => {
    expect(
      bunVersionPinViolations(
        setupBunPins(
          `jobs:\n  check:\n    steps:\n      - uses: ${SETUP_BUN}\n        with:\n          bun-version: 1.10\n`,
          "fixture.yml",
        ),
      ).join("\n"),
    ).toContain("fixture.yml: setup-bun の bun-version (1.1) を引用符で囲む");
  });

  test("空の YAML の file からは版を集めない", () => {
    expect(setupBunPins("", "empty.yml")).toEqual([]);
  });

  test("composite action の setup-bun の版も集める", () => {
    expect(
      setupBunPins(
        `runs:\n  using: composite\n  steps:\n    - uses: ${SETUP_BUN}\n      with:\n        bun-version: "1.4"\n`,
        "action.yml",
      ),
    ).toEqual([{ place: "action.yml", version: "1.4" }]);
  });
});
