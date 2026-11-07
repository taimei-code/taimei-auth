import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import taimeiPlugin from "../../lint/oxlint-plugin.mjs";
import { REPO_ROOT } from "./source-scan";

const enabledTaimeiRules = () =>
  [
    ...new Set(
      [
        ...readFileSync(path.join(REPO_ROOT, ".oxlintrc.json"), "utf8").matchAll(
          /"taimei\/([a-z-]+)"/g,
        ),
      ].map(([, rule]) => rule),
    ),
  ].sort();

test("この repo の oxlint の plugin の rule は、すべて .oxlintrc.json で使い、使う rule はすべて plugin にある", () => {
  expect(Object.keys(taimeiPlugin.rules).sort()).toEqual(enabledTaimeiRules());
});
