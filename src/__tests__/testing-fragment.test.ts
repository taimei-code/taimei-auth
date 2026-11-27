import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

const composeService = (composePath: string, service: string) =>
  (
    Bun.YAML.parse(readFileSync(join(REPO_ROOT, composePath), "utf8")) as {
      services: Record<string, { env_file?: string | string[] }>;
    }
  ).services[service] ?? {};

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

  test("template の auth ホストの image は、生成が置き換える placeholder である (smoke は image を override で与えるので、placeholder の崩れを見ない)", () => {
    const fragment = Bun.YAML.parse(template()) as {
      services: { "taimei-auth": { image?: string } };
    };

    expect(fragment.services["taimei-auth"].image).toBe(PLACEHOLDER);
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

const SERVICE_KEY_FILE = "testing/service-key.env";

describe("consumer と共有する service key は、SDK に同梱する 1 つの file に置く", () => {
  test("service key の file は git に無視されず、SDK の files に入る", () => {
    const pkg = JSON.parse(readFileSync(join(SDK_DIR, "package.json"), "utf8"));

    expect(pkg.files).toContain(SERVICE_KEY_FILE);
    expect(run(["git", "check-ignore", "-q", SERVICE_KEY_FILE], SDK_DIR).exitCode).toBe(1);
  });

  test("service key の file は AUTH_SERVICE_KEY=<値> の 1 行だけを持ち、値は compose の env_file と wrangler の env-file の quote と展開に触れない文字だけでできている", () => {
    expect(readFileSync(join(SDK_DIR, SERVICE_KEY_FILE), "utf8")).toMatch(
      /^AUTH_SERVICE_KEY=[A-Za-z0-9._-]+\n$/,
    );
  });

  test("断片は AUTH_SERVICE_KEY を変数にも environment にも持たない (consumer の変数を求めず、environment の値は env_file の SDK の file の値に勝つため)", () => {
    expect(template()).not.toContain("AUTH_SERVICE_KEY");
  });

  test("開発環境の compose と断片は、service key を同じ SDK の file から読む (相対の env_file は、その compose の file の dir から解決される)", () => {
    const lastEnvFile = (composePath: string, service: string) => {
      const envFile = [composeService(composePath, service).env_file ?? []].flat().at(-1) ?? "";
      return resolve(REPO_ROOT, dirname(composePath), envFile);
    };

    expect(lastEnvFile(TEMPLATE_PATH, "taimei-auth")).toBe(join(SDK_DIR, SERVICE_KEY_FILE));
    expect(lastEnvFile("docker-compose.yml", "auth-service")).toBe(join(SDK_DIR, SERVICE_KEY_FILE));
  });
});

describe("断片は repo の試験の値を使う", () => {
  test("断片の MFA の暗号鍵は、repo の試験の鍵と同じ値である", () => {
    expect(template()).toContain(`MFA_TOTP_ENCRYPTION_KEYS: ${TEST_MFA_TOTP_ENCRYPTION_KEYS}\n`);
  });
});

const DEVELOPMENT_OVERLAY_FILE = "testing/compose.development.yml";
const DEVELOPMENT_OVERLAY_PATH = `packages/auth-client/${DEVELOPMENT_OVERLAY_FILE}`;

type ComposeNetworks = string[] | Record<string, unknown>;
type DevelopmentOverlay = {
  services: Record<string, Record<string, unknown>>;
  networks?: Record<string, { name?: string; external?: boolean }>;
};
type DevEnvironmentCompose = {
  services: Record<string, { networks?: ComposeNetworks; environment?: Record<string, unknown> }>;
  networks?: Record<string, { name?: string }>;
};

const developmentOverlayText = () =>
  readFileSync(join(REPO_ROOT, DEVELOPMENT_OVERLAY_PATH), "utf8");
const developmentOverlay = () => Bun.YAML.parse(developmentOverlayText()) as DevelopmentOverlay;
const networkKeys = (networks: ComposeNetworks | undefined) =>
  Array.isArray(networks) ? networks : Object.keys(networks ?? {});

describe("consumer は SDK の上書きの file を 2 つ目の -f で足し、taimei-auth を開発環境への中継に差し替える", () => {
  test("上書きの file は SDK の files に入り、git の対象である", () => {
    const pkg = JSON.parse(readFileSync(join(SDK_DIR, "package.json"), "utf8"));

    expect(pkg.files).toContain(DEVELOPMENT_OVERLAY_FILE);
    expect(run(["git", "check-ignore", "-q", DEVELOPMENT_OVERLAY_FILE], SDK_DIR).exitCode).toBe(1);
  });

  test("上書きの file は、consumer の compose が足した ports と depends_on を !reset で消し、command を !override で置き換える (tag の無い値は consumer の値と merge され、残る)", () => {
    const text = developmentOverlayText();

    expect(text).toMatch(/^ {4}ports: !reset /m);
    expect(text).toMatch(/^ {4}depends_on: !reset /m);
    expect(text).toMatch(/^ {4}command: !override /m);
  });

  test("上書きの file は変数を参照しない (consumer は断片の変数を include に閉じた env の file で渡すので、2 つ目の file からは見えない)", () => {
    expect(developmentOverlayText()).not.toContain("$");
  });

  test("上書きの file は taimei-auth の名前、別名、environment、health check を設定し直さない (consumer の healthy の待ちが、開発環境が答えるまでの待ちになる)", () => {
    const relay = developmentOverlay().services["taimei-auth"];

    expect(relay).toBeDefined();
    expect(
      Object.keys(relay ?? {}).filter((key) =>
        ["environment", "env_file", "healthcheck"].includes(key),
      ),
    ).toEqual([]);
    expect(
      Object.keys((relay?.networks as Record<string, unknown> | undefined) ?? {}),
    ).not.toContain("default");
  });

  test("中継の宛先は、開発環境の compose が上書きの file と同じ名前の network に置いた service で、port はその service が待ち受ける port である (host の port に渡すと、同じ port で動く別の auth に黙ってつながる)", () => {
    const overlay = developmentOverlay();
    const command = overlay.services["taimei-auth"]?.command as string[];
    const [, host = "", port = ""] = /^(.+):(\d+)$/.exec(command.at(-1) ?? "") ?? [];
    const devCompose = Bun.YAML.parse(
      readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8"),
    ) as DevEnvironmentCompose;
    const target = devCompose.services[host];
    const targetNetworkNames = networkKeys(target?.networks).map(
      (key) => devCompose.networks?.[key]?.name ?? key,
    );
    const externalNetworkNames = Object.values(overlay.networks ?? {})
      .filter((network) => network.external === true)
      .map((network) => network.name);

    const relayNetworkNames = Object.keys(
      (overlay.services["taimei-auth"]?.networks as Record<string, unknown> | undefined) ?? {},
    ).map((key) => overlay.networks?.[key]?.name ?? key);

    expect(target).toBeDefined();
    expect(externalNetworkNames.length).toBeGreaterThan(0);
    expect(relayNetworkNames).toEqual(expect.arrayContaining(externalNetworkNames));
    expect(targetNetworkNames).toEqual(expect.arrayContaining(externalNetworkNames));
    expect(String(target?.environment?.PORT)).toBe(port);
  });
});
