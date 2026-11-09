import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import { REPO_ROOT } from "./source-scan";

const RuleSettings = Schema.Record(Schema.String, Schema.Unknown);
const Override = Schema.Struct({
  files: Schema.Array(Schema.String),
  rules: Schema.optional(RuleSettings),
});
const Config = Schema.fromJsonString(
  Schema.Struct({ rules: Schema.optional(RuleSettings), overrides: Schema.Array(Override) }),
);

const readConfig = (file: string) =>
  Schema.decodeSync(Config)(readFileSync(path.join(REPO_ROOT, file), "utf8"));

const repoConfig = readConfig(".oxlintrc.json");
const recommended = readConfig("node_modules/@foldkit/oxlint-plugin/recommended.json");

const foldkitRulesOf = (rules: Readonly<Record<string, unknown>> | undefined) =>
  Object.fromEntries(Object.entries(rules ?? {}).filter(([rule]) => rule.startsWith("foldkit/")));

const repoOverrideRules = (files: readonly string[]) =>
  Object.assign(
    {},
    ...repoConfig.overrides
      .filter((override) => override.files.join() === files.join())
      .map((override) => foldkitRulesOf(override.rules)),
  );

const recommendedOverride = (glob: string) => {
  const override = recommended.overrides.find((candidate) => candidate.files.includes(glob));
  if (override === undefined) {
    throw new Error(`recommended.json に ${glob} を files に持つ override が無い`);
  }
  return override;
};

const recommendedEntryRules = () => foldkitRulesOf(recommendedOverride("**/entry.ts").rules);

test("web/src と web/non-production の Foldkit の lint は、入れた版の recommended の rule と値をそのまま写す", () => {
  expect(repoOverrideRules(["web/src/**", "web/non-production/**"])).toEqual(
    foldkitRulesOf(recommended.rules),
  );
});

test("application の entry では、recommended が entry に許す rule を同じく緩める", () => {
  expect(repoOverrideRules(["web/src/app/*/entry.ts", "web/non-production/main.ts"])).toEqual(
    recommendedEntryRules(),
  );
});

test("test の file では、recommended が test に許す rule を同じ files で同じく緩める", () => {
  const testOverride = recommendedOverride("**/*.test.ts");
  expect(repoOverrideRules(testOverride.files)).toEqual(foldkitRulesOf(testOverride.rules));
});
