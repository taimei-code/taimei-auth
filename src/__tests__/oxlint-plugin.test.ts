import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import taimeiPlugin from "../../lint/oxlint-plugin.mjs";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");

const enabledTaimeiRules = () =>
  [...readFileSync(path.join(REPO_ROOT, ".oxlintrc.json"), "utf8").matchAll(/"taimei\/([a-z-]+)"/g)]
    .map(([, rule]) => rule)
    .filter((rule, index, rules) => rules.indexOf(rule) === index)
    .sort();

test("この repo の oxlint の plugin の rule は、すべて .oxlintrc.json で使い、使う rule はすべて plugin にある", () => {
  expect(Object.keys(taimeiPlugin.rules).sort()).toEqual(enabledTaimeiRules());
});
