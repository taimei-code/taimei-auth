import { describe, expect, test } from "bun:test";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc, REPO_ROOT, symmetricDifference } from "./config-invariant-helpers";
import { grepLines, repoFiles } from "./source-scan";

const WRANGLER_DEV_SCRIPT = "scripts/wrangler-dev.sh";

const namesInScript = (arrayName: string): string[] => {
  const script = readFileSync(join(REPO_ROOT, WRANGLER_DEV_SCRIPT), "utf8");
  const match = script.match(new RegExp(`${arrayName}=\\(([^)]*)\\)`));
  if (!match?.[1]) throw new Error(`${arrayName}=( ... ) が ${WRANGLER_DEV_SCRIPT} に無い`);
  return match[1].split(/\s+/).filter((k) => k.length > 0);
};

const overrideAlways = () => namesInScript("OVERRIDE_ALWAYS");

function wranglerVarKeys(configPath: string): string[] {
  const config = parseJsonc(readFileSync(join(REPO_ROOT, configPath), "utf8")) as unknown as {
    vars?: Record<string, unknown>;
  };
  return Object.keys(config.vars ?? {});
}

describe("scripts/wrangler-dev.sh の OVERRIDE_ALWAYS (wrangler dev は process の環境変数を binding にしないので、vars を空でも上書きしないと本番の値が local に漏れる)", () => {
  test.each([
    "wrangler.jsonc",
    "testing/wrangler.jsonc",
  ])("%s の vars の key 集合と一致する", (configPath) => {
    expect(symmetricDifference(overrideAlways(), wranglerVarKeys(configPath))).toEqual([]);
  });
});

const WRITTEN_BY_SCRIPT = ["NON_PRODUCTION_DATABASE_URL"];
const NOT_FOR_WORKER = [
  "DATABASE_URL",
  "NODE_ENV",
  "PORT",
  "CF_VERSION_ID",
  "AUTH_TRUSTED_PROXY_HOPS",
];

const ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)|envOr\("([A-Z][A-Z0-9_]*)"/g;

const envNamesRead = (): string[] => [
  ...new Set(
    grepLines('process\\.env\\.[A-Z]|envOr\\("[A-Z]', ["src", "testing", "db"], {
      tests: "exclude",
    }).flatMap((line) => [...line.matchAll(ENV_READ)].map((match) => match[1] ?? match[2] ?? "")),
  ),
];

const namesOutsideLists = (read: readonly string[], lists: readonly (readonly string[])[]) =>
  read.filter((name) => !lists.some((list) => list.includes(name))).sort();

const textOutsideScript = (): string =>
  repoFiles()
    .filter(
      (file) =>
        file !== WRANGLER_DEV_SCRIPT &&
        lstatSync(join(REPO_ROOT, file), { throwIfNoEntry: false })?.isFile(),
    )
    .map((file) => readFileSync(join(REPO_ROOT, file), "utf8"))
    .join("\n");

describe("scripts/wrangler-dev.sh は worker が読む env を名前で渡す (接頭辞の正規表現では、新しい接頭辞の env が worker に届かず undefined のまま動く)", () => {
  const lists = () => [
    overrideAlways(),
    namesInScript("PASS_THROUGH"),
    WRITTEN_BY_SCRIPT,
    NOT_FOR_WORKER,
  ];

  test("src・testing・db が読む env の名前は、どれかの一覧にある", () => {
    expect(envNamesRead().length).toBeGreaterThan(10);
    expect(namesOutsideLists(envNamesRead(), lists())).toEqual([]);
  });

  test("どの一覧にも無い名前は報告される", () => {
    expect(namesOutsideLists([...envNamesRead(), "NEW_SETTING"], lists())).toEqual(["NEW_SETTING"]);
  });

  test("PASS_THROUGH の名前は、どれも script の外の追跡中の file に出る (使われなくなった名前を残さない)", () => {
    const elsewhere = textOutsideScript();
    expect(
      namesInScript("PASS_THROUGH").filter((name) => !new RegExp(`\\b${name}\\b`).test(elsewhere)),
    ).toEqual([]);
  });
});
