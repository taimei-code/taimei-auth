import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./config-invariant-helpers";
import { TEST_MFA_TOTP_ENCRYPTION_KEYS } from "./test-env";

const GENERATE_FRAGMENT_SCRIPT = join(REPO_ROOT, "scripts/generate-testing-fragment.sh");
const SDK_DIR = join(REPO_ROOT, "packages/auth-client");
const TEMPLATE_PATH = "packages/auth-client/testing/compose.template.yml";
const FRAGMENT_PATH = "packages/auth-client/testing/compose.yml";
const PLACEHOLDER = "__TAIMEI_AUTH_TESTING_IMAGE__";
const IMAGE_WITH_DIGEST = `ghcr.io/taimei-code/taimei-auth-testing@sha256:${"a".repeat(64)}`;
const EXPECTED_IMAGE_FORM = "expected ghcr.io/taimei-code/taimei-auth-testing@sha256:<digest>";

const template = () => readFileSync(join(REPO_ROOT, TEMPLATE_PATH), "utf8");

const run = (command: string[], cwd = REPO_ROOT) => {
  const result = Bun.spawnSync(command, { cwd });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    combinedOutput: `${result.stdout.toString()}${result.stderr.toString()}`,
    stderr: result.stderr.toString(),
  };
};

const generateFragment = (...args: string[]) => run(["bash", GENERATE_FRAGMENT_SCRIPT, ...args]);

const packageDirs: string[] = [];

afterEach(() => {
  for (const dir of packageDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const packageDirWithFragment = (fragment: string | undefined) => {
  const dir = mkdtempSync(join(tmpdir(), "auth-client-package-"));
  packageDirs.push(dir);
  copyFileSync(join(SDK_DIR, "package.json"), join(dir, "package.json"));
  if (fragment !== undefined) {
    mkdirSync(join(dir, "testing"));
    writeFileSync(join(dir, "testing/compose.yml"), fragment);
  }
  return dir;
};

describe("断片の生成は、digest で固定した試験用の image だけを受ける", () => {
  test("digest の形の image を渡すと、template の image をその image に置き換えた断片を出す", () => {
    const result = generateFragment(IMAGE_WITH_DIGEST);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(template().replace(PLACEHOLDER, IMAGE_WITH_DIGEST));
    expect(result.stdout).not.toContain(PLACEHOLDER);
  });

  test("tag の形の image を渡すと、何も出さずに 0 以外で終わる", () => {
    const result = generateFragment("ghcr.io/taimei-code/taimei-auth-testing:auth-client-v3.6.0");

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(EXPECTED_IMAGE_FORM);
    expect(result.stdout).toBe("");
  });

  test.each([
    ["digest が 63 桁", `ghcr.io/taimei-code/taimei-auth-testing@sha256:${"a".repeat(63)}`],
    ["別の repository", `ghcr.io/taimei-code/other@sha256:${"a".repeat(64)}`],
  ])("%s の image を渡すと、0 以外で終わる", (_, image) => {
    const result = generateFragment(image);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(EXPECTED_IMAGE_FORM);
  });

  test("image を渡さないと、0 以外で終わる", () => {
    const result = generateFragment();

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(EXPECTED_IMAGE_FORM);
  });
});

describe("digest の無い断片は publish しない", () => {
  test.each([
    ["断片が無い", undefined],
    ["template のままの断片", template()],
  ])("%s と、prepublishOnly は build の前に 0 以外で終わる", (_, fragment) => {
    const dir = packageDirWithFragment(fragment);
    const result = run(["bun", "run", "prepublishOnly"], dir);

    expect(result.exitCode).not.toBe(0);
    expect(run(["bun", "run", "check:testing-fragment"], dir).exitCode).not.toBe(0);
    expect(result.combinedOutput).not.toContain("rm -rf dist");
  });

  test("生成した断片は、publish の前の検査を通る", () => {
    const dir = packageDirWithFragment(generateFragment(IMAGE_WITH_DIGEST).stdout);

    expect(run(["bun", "run", "check:testing-fragment"], dir).exitCode).toBe(0);
  });
});

describe("断片は git で管理せず、SDK の package に入れる", () => {
  test("SDK の files に、生成した断片が入る", () => {
    const pkg = JSON.parse(readFileSync(join(SDK_DIR, "package.json"), "utf8"));

    expect(pkg.files).toContain("testing/compose.yml");
  });

  test("生成した断片は git の対象外で、template は git の対象", () => {
    expect(run(["git", "check-ignore", "-q", FRAGMENT_PATH]).exitCode).toBe(0);
    expect(run(["git", "check-ignore", "-q", TEMPLATE_PATH]).exitCode).toBe(1);
  });
});

describe("consumer が書く設定は TAIMEI_AUTH_* だけで、DB は断片の中に閉じる", () => {
  test("断片の DATABASE_URL は、断片の Postgres を指す", () => {
    expect(template()).toMatch(/DATABASE_URL: postgres:\/\/[^\s]*@taimei-auth-postgres:5432\//);
  });

  test("断片の Postgres は data を名前付き volume に置くので、down の後の up でも DB が残り、down -v で消える", () => {
    const fragment = Bun.YAML.parse(template()) as {
      services: { "taimei-auth-postgres": { volumes?: string[]; tmpfs?: unknown } };
      volumes?: Record<string, unknown>;
    };
    const postgres = fragment.services["taimei-auth-postgres"];

    expect(postgres.volumes).toEqual(["taimei-auth-postgres-data:/var/lib/postgresql/data"]);
    expect(postgres.tmpfs).toBeUndefined();
    expect(Object.keys(fragment.volumes ?? {})).toEqual(["taimei-auth-postgres-data"]);
  });

  test("断片が参照する変数は、すべて TAIMEI_AUTH_ で始まる", () => {
    const variables = [...template().matchAll(/\$\{([A-Z_]+)/g)].map(([, name]) => name);

    expect(variables.length).toBeGreaterThan(0);
    expect(variables.filter((name) => !name?.startsWith("TAIMEI_AUTH_"))).toEqual([]);
  });
});

describe("断片は repo の試験の値を使う", () => {
  test("断片の MFA の暗号鍵は、repo の試験の鍵と同じ値である", () => {
    expect(template()).toContain(`MFA_TOTP_ENCRYPTION_KEYS: ${TEST_MFA_TOTP_ENCRYPTION_KEYS}\n`);
  });
});
