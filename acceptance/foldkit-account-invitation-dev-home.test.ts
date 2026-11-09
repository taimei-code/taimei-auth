import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] => {
  const result = spawnSync(
    "git",
    ["grep", "-n", "-E", "--untracked", pattern, "--", ...pathspecs],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return result.stdout.split("\n").filter((line) => line !== "");
};

const gitFiles = (...pathspecs: string[]): string[] => {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspecs],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return result.stdout
    .split("\n")
    .filter((line) => line !== "" && existsSync(join(REPO_ROOT, line)));
};

const wordPattern = (alternatives: string) =>
  `(^|[^A-Za-z0-9_])(${alternatives})([^A-Za-z0-9_]|$)`;

const pathOfHit = (line: string) => line.split(":")[0] ?? "";

const isTestPath = (path: string) => path.includes("/__tests__/") || /\.test\.tsx?$/.test(path);

const nonTestHits = (lines: string[]) => lines.filter((line) => !isTestPath(pathOfHit(line)));

const importsFoldkit = (source: string) => /from\s+["']foldkit(\/[^"']*)?["']/.test(source);

const foldkitProgramsIn = (dir: string): string[] =>
  gitFiles(`${dir}/*.ts`).filter((path) => {
    const source = read(path);
    return importsFoldkit(source) && /export const update\b/.test(source);
  });

const ACCOUNT_PAGE_DIR = "web/src/account/pages";
const INVITATION_PAGE_DIR = "web/src/invitation/pages";
const NON_PRODUCTION_DIR = "web/non-production";
const MIGRATED_PAGE_DIRS = [ACCOUNT_PAGE_DIR, INVITATION_PAGE_DIR];

const AUTH_ORIGIN = "https://auth.taimei-code.com";

type Application = {
  init: (url: unknown) => { readonly model: unknown };
  update: (model: unknown, message: unknown) => { readonly model: unknown };
  view: (model: unknown, h: unknown) => unknown;
};

type Assertion = {
  toExist: () => unknown;
  toBeAbsent: () => unknown;
  toHaveAttr: (name: string, value?: string) => unknown;
};

type SceneModule = {
  scene: (config: { update: unknown; view: unknown }, ...steps: unknown[]) => void;
  given: (model: unknown) => unknown;
  expect: (locator: unknown) => Assertion;
  role: (role: string, options?: { name: string }) => unknown;
  text: (text: string) => unknown;
};

const importOrUndefined = async <A>(path: string): Promise<A | undefined> => {
  try {
    return await import(join(REPO_ROOT, path));
  } catch {
    return undefined;
  }
};

const sceneOf = async (applicationPath: string) => {
  const application = await importOrUndefined<Application>(applicationPath);
  expect(application).toBeDefined();
  const Scene: SceneModule = await import("foldkit/scene");
  const Url: { fromString: (href: string) => { _tag: string; value?: unknown } } = await import(
    "foldkit/url"
  );
  return (href: string, ...steps: (scene: SceneModule) => unknown[]) => {
    const url = Url.fromString(href);
    if (url._tag !== "Some" || application === undefined) {
      throw new Error(`URL として読めない: ${href}`);
    }
    Scene.scene(
      { update: application.update, view: application.view },
      Scene.given(application.init(url.value).model),
      ...steps.flatMap((step) => step(Scene)),
    );
  };
};

const ACCEPT_INVITATION_FAILED_TITLE = "招待を受諾できませんでした";

describe("招待の受諾の画面を開くと受諾を確かめる", () => {
  test("AC-002: 招待のトークンのある URL を開いた直後は status を出し、受諾できなかった画面を出さない", async () => {
    const sceneAt = await sceneOf("web/src/app/auth/main.ts");
    sceneAt(
      `${AUTH_ORIGIN}/auth/signup/accept-invitation?invitation_token=e2e-invitation-token`,
      (Scene) => [
        Scene.expect(Scene.role("status")).toExist(),
        Scene.expect(Scene.text(ACCEPT_INVITATION_FAILED_TITLE)).toBeAbsent(),
      ],
    );
  });

  test("AC-003: 招待のトークンの無い URL を開くと、トークンが見つからない文言と /account へ戻る link を出す", async () => {
    const sceneAt = await sceneOf("web/src/app/auth/main.ts");
    sceneAt(`${AUTH_ORIGIN}/auth/signup/accept-invitation`, (Scene) => [
      Scene.expect(Scene.text(ACCEPT_INVITATION_FAILED_TITLE)).toExist(),
      Scene.expect(Scene.text("招待トークンが見つかりません。")).toExist(),
      Scene.expect(Scene.role("link", { name: "アカウントに戻る" })).toHaveAttr("href", "/account"),
      Scene.expect(Scene.role("status")).toBeAbsent(),
    ]);
  });
});

describe("移した画面の React の code", () => {
  test("AC-004: web/src に React の招待の受諾の code を書かない", () => {
    expect(
      gitGrep(
        wordPattern("acceptInvitationOutcome|acceptInvitationAtom|SignUpAcceptInvitation") + "|path: ACCEPT_INVITATION_ROUTE",
        "web/src",
      ),
    ).toEqual([]);
  });

  test("AC-007: web/non-production の test 以外の file に react・react-dom を import しない", () => {
    expect(
      nonTestHits(gitGrep(String.raw`from ["']react(-dom)?(/[^"']*)?["']`, NON_PRODUCTION_DIR)),
    ).toEqual([]);
  });

  test("AC-024: web/src に React のアカウント管理画面の枠・トップ・セッション・連携アカウント・退会の code を書かない", () => {
    expect(
      gitGrep(
        wordPattern("AccountLayout|ProfileForm|AvatarUploader|DangerZone|SignOutButton|sessionsAtom|linkedAccountsAtom|accountEntryOf"),
        "web/src",
      ),
    ).toEqual([]);
  });
});

describe("既存の保証", () => {
  test("AC-006: 戻り先の検査の既存の試験が通る", () => {
    const result = spawnSync("bun", ["test", "./web/src/invitation/__tests__/redirect-target.test.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  test("AC-009: 本番の bundle の検査の既存の試験が通る", () => {
    const result = spawnSync(
      "bun",
      [
        "test",
        "./testing/__tests__/production-bundle-check.test.ts",
        "./src/__tests__/production-tree.test.ts",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
  });
});

describe("アカウント管理画面を開くと入口の確認をする", () => {
  test("AC-016: /account を開いた直後は status を出し、プロフィールの見出しとログアウトのボタンを出さない", async () => {
    const sceneAt = await sceneOf("web/src/app/account/main.ts");
    sceneAt(`${AUTH_ORIGIN}/account`, (Scene) => [
      Scene.expect(Scene.role("status")).toExist(),
      Scene.expect(Scene.role("heading", { name: "プロフィール" })).toBeAbsent(),
      Scene.expect(Scene.role("button", { name: "ログアウト" })).toBeAbsent(),
    ]);
  });
});

describe("better-auth の一覧の読み出しと dialog の置き場", () => {
  test("AC-020: better-auth の一覧の読み出しを書く file は 1 つ以下で、その file は Atom を import しない", () => {
    const files = [
      ...new Set(
        nonTestHits(gitGrep(String.raw`\.(listSessions|listAccounts)\(`, "web/src")).map(pathOfHit),
      ),
    ];
    expect(files.length).toBeLessThanOrEqual(1);
    for (const file of files) {
      expect(read(file)).not.toMatch(/from\s+["'](effect\/reactivity|@effect\/atom-react)["']/);
    }
  });

  test("AC-021: shared/ui/dialog-view.ts の外で @foldkit/ui の Dialog を import しない", () => {
    const hits = gitGrep(
      String.raw`import[^;]*\bDialog\b[^;]*from ["']@foldkit/ui["']`,
      "web/src",
      NON_PRODUCTION_DIR,
    );
    expect(hits.map(pathOfHit).filter((path) => path !== "web/src/shared/ui/dialog-view.ts")).toEqual(
      [],
    );
  });
});

type LintCase = { readonly path: string; readonly source: string };

const RAW_BUTTON_SOURCE =
  'import type { HtmlBuilder } from "foldkit/html";\nexport const view = <M>(h: HtmlBuilder<M>) => h.button([], ["x"]);\n';

const MODULE_LET_SOURCE =
  'import { Command } from "foldkit";\nexport let counter = 0;\nexport { Command };\n';

const LINT_CASES = {
  moduleLetInNonProduction: { path: "web/non-production/ModuleLetProbe.ts", source: MODULE_LET_SOURCE },
  rawButtonInNonProduction: { path: "web/non-production/RawButtonProbe.ts", source: RAW_BUTTON_SOURCE },
  dialogImportInAccountPage: {
    path: "web/src/account/pages/DialogImportProbe.ts",
    source:
      'import { Dialog } from "@foldkit/ui";\nimport { Command } from "foldkit";\nexport { Command, Dialog };\n',
  },
  atomImportInAccountPage: {
    path: "web/src/account/pages/AtomImportProbe.ts",
    source:
      'import { Command } from "foldkit";\nimport { companyStateAtom } from "../account-atom";\nexport { Command, companyStateAtom };\n',
  },
  rawButtonInAccountPage: { path: "web/src/account/pages/RawButtonProbe.ts", source: RAW_BUTTON_SOURCE },
  rawButtonInInvitationPage: {
    path: "web/src/invitation/pages/RawButtonProbe.ts",
    source: RAW_BUTTON_SOURCE,
  },
  moduleLetInAccountPage: { path: "web/src/account/pages/ModuleLetProbe.ts", source: MODULE_LET_SOURCE },
  moduleLetInInvitationPage: {
    path: "web/src/invitation/pages/ModuleLetProbe.ts",
    source: MODULE_LET_SOURCE,
  },
} satisfies Record<string, LintCase>;

type Diagnostic = { readonly filename: string; readonly severity: string };

const fixtureErrorsByPath = new Map<string, number>();
let lintFixtureDir = "";

const countErrors = (diagnostics: readonly Diagnostic[], into: Map<string, number>) => {
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      into.set(diagnostic.filename, (into.get(diagnostic.filename) ?? 0) + 1);
    }
  }
};

const repoConfigForFixture = (): string => {
  const config: { jsPlugins?: Array<string | { name: string; specifier: string }> } = JSON.parse(
    read(".oxlintrc.json"),
  );
  const absolute = (specifier: string) =>
    specifier.startsWith(".") ? join(REPO_ROOT, specifier) : specifier;
  const jsPlugins = (config.jsPlugins ?? []).map((plugin) =>
    typeof plugin === "string"
      ? absolute(plugin)
      : { ...plugin, specifier: absolute(plugin.specifier) },
  );
  return JSON.stringify({ ...config, jsPlugins });
};

const oxlintJson = (cwd: string, ...targets: string[]): Diagnostic[] => {
  const result = spawnSync(
    join(REPO_ROOT, "node_modules/.bin/oxlint"),
    ["--disable-nested-config", "--format", "json", ...targets],
    { cwd, encoding: "utf8" },
  );
  const report: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  return report.diagnostics;
};

beforeAll(() => {
  lintFixtureDir = mkdtempSync(join(tmpdir(), "acceptance-oxlint-390-"));
  writeFileSync(join(lintFixtureDir, ".oxlintrc.json"), repoConfigForFixture());
  symlinkSync(join(REPO_ROOT, "node_modules"), join(lintFixtureDir, "node_modules"));
  for (const { path, source } of Object.values(LINT_CASES)) {
    mkdirSync(dirname(join(lintFixtureDir, path)), { recursive: true });
    writeFileSync(join(lintFixtureDir, path), source);
  }
  countErrors(oxlintJson(lintFixtureDir, "web"), fixtureErrorsByPath);
});

afterAll(() => {
  if (lintFixtureDir !== "") {
    rmSync(lintFixtureDir, { recursive: true, force: true });
  }
});

const fixtureErrors = (lintCase: LintCase) => fixtureErrorsByPath.get(lintCase.path) ?? 0;

describe("oxlint は移した画面に効く", () => {
  test("AC-008: web/non-production の foldkit の file の module の let と h.button を error にする", () => {
    expect(fixtureErrors(LINT_CASES.moduleLetInNonProduction)).toBeGreaterThan(0);
    expect(fixtureErrors(LINT_CASES.rawButtonInNonProduction)).toBeGreaterThan(0);
  });

  test("AC-022: account の pages で @foldkit/ui の Dialog を import する file を error にする", () => {
    expect(fixtureErrors(LINT_CASES.dialogImportInAccountPage)).toBeGreaterThan(0);
  });

  test("AC-023: account の pages で foldkit と *-atom.ts を import する file を error にする", () => {
    expect(fixtureErrors(LINT_CASES.atomImportInAccountPage)).toBeGreaterThan(0);
  });

  test("AC-026: account と invitation の pages の h.button を error にする", () => {
    expect(fixtureErrors(LINT_CASES.rawButtonInAccountPage)).toBeGreaterThan(0);
    expect(fixtureErrors(LINT_CASES.rawButtonInInvitationPage)).toBeGreaterThan(0);
  });

  test("AC-027: account と invitation の pages に Foldkit の page があり、それらと web/non-production の foldkit の file に lint の error が無く、同じ dir の module の let は error になる", () => {
    const pages = MIGRATED_PAGE_DIRS.map(foldkitProgramsIn);
    expect(pages.map((dirPages) => dirPages.length > 0)).toEqual([true, true]);
    const nonProduction = gitFiles(`${NON_PRODUCTION_DIR}/*.ts`).filter((path) =>
      importsFoldkit(read(path)),
    );
    expect(nonProduction.length).toBeGreaterThan(0);
    const errors = new Map<string, number>();
    countErrors(oxlintJson(REPO_ROOT, ...pages.flat(), ...nonProduction), errors);
    expect([...errors.entries()]).toEqual([]);
    expect(fixtureErrors(LINT_CASES.moduleLetInAccountPage)).toBeGreaterThan(0);
    expect(fixtureErrors(LINT_CASES.moduleLetInInvitationPage)).toBeGreaterThan(0);
  });
});

describe("house の部品の外の素の要素", () => {
  test("AC-028: web/src と web/non-production の shared/ui の外の test 以外の file に h.button・h.input・h.textarea・h.select を書かない", () => {
    const hits = gitGrep(
      String.raw`(^|[^A-Za-z0-9_.])h\.(button|input|textarea|select)\(`,
      "web/src/app",
      "web/src/auth",
      "web/src/mfa",
      "web/src/account",
      "web/src/company",
      "web/src/invitation",
      "web/src/membership",
      ":(glob)web/src/shared/*.ts",
      ":(glob)web/src/*.ts",
      NON_PRODUCTION_DIR,
    );
    expect(nonTestHits(hits)).toEqual([]);
  });
});

const storyAndSceneTestsOf = (program: string) => {
  const name = basename(program, ".ts");
  const programDir = dirname(program);
  const testsDir = programDir.endsWith("/pages")
    ? join(dirname(programDir), "__tests__")
    : join(programDir, "__tests__");
  return {
    story: join(testsDir, `${name}.story.test.ts`),
    scene: join(testsDir, `${name}.scene.test.ts`),
  };
};

const testNamesIn = (path: string): string[] =>
  [...read(path).matchAll(/\btest(?:\.each\([\s\S]*?\))?\(\s*["'`]([^"'`]+)["'`]/g)].map(
    ([, name]) => name ?? "",
  );

const migratedPages = () => MIGRATED_PAGE_DIRS.flatMap(foldkitProgramsIn);

describe("page ごとの Story テストと Scene テスト", () => {
  test("AC-029: 移した Foldkit の page と開発者ホームの program ごとに、__tests__ に Story テストと Scene テストがあり、bun test で通る", () => {
    const programs = [...migratedPages(), ...foldkitProgramsIn(NON_PRODUCTION_DIR)];
    expect(programs.length).toBeGreaterThanOrEqual(MIGRATED_PAGE_DIRS.length + 1);
    const tests = programs.flatMap((program) => {
      const { story, scene } = storyAndSceneTestsOf(program);
      return [story, scene];
    });
    expect(tests.filter((path) => !existsSync(join(REPO_ROOT, path)))).toEqual([]);
    const result = spawnSync("bun", ["test", ...tests.map((path) => `./${path}`)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  test("AC-030: account と invitation の page の Story テストは、二重の操作と古い応答の test を持つ", () => {
    const pages = migratedPages();
    expect(pages.length).toBeGreaterThanOrEqual(MIGRATED_PAGE_DIRS.length);
    const names = pages
      .map((page) => storyAndSceneTestsOf(page).story)
      .filter((path) => existsSync(join(REPO_ROOT, path)))
      .flatMap(testNamesIn);
    expect(names.filter((name) => name.includes("二重"))).not.toEqual([]);
    expect(names.filter((name) => name.includes("古い"))).not.toEqual([]);
  });
});

describe("Foldkit の書き方", () => {
  test("AC-031: account と invitation の pages と web/non-production の test 以外の file に Effect.die・Effect.orDie を書かない", () => {
    expect(
      nonTestHits(
        gitGrep(String.raw`(^|[^A-Za-z0-9_.])Effect\.(die|orDie)([^A-Za-z0-9_]|$)`, ...MIGRATED_PAGE_DIRS, NON_PRODUCTION_DIR),
      ),
    ).toEqual([]);
  });

  test("AC-032: account と invitation の Foldkit の page は Model・Message・init・update・view を直接 export し、domain に index.ts が無い", () => {
    const pages = migratedPages();
    expect(pages.length).toBeGreaterThanOrEqual(MIGRATED_PAGE_DIRS.length);
    for (const page of pages) {
      const source = read(page);
      for (const name of ["Model", "Message", "init", "update", "view"]) {
        expect(source).toMatch(new RegExp(String.raw`export const ${name}\b`));
      }
    }
    expect(gitFiles("web/src/account/index.ts", "web/src/invitation/index.ts")).toEqual([]);
  });

  test("AC-033: web/src と web/non-production に page や application を作る独自の関数を書かない", () => {
    expect(
      gitGrep(
        wordPattern("definePage|defineElement|startRoutingApplication"),
        "web/src",
        NON_PRODUCTION_DIR,
      ),
    ).toEqual([]);
  });
});

describe("手動回帰の契機", () => {
  test("AC-034: 契機の path は消した React の file を挙げず、契機の検査が通る", () => {
    expect(
      gitGrep(
        String.raw`web/non-production/(DevHomePage\.tsx|main\.tsx)|web/src/app/AccountLayout\.tsx|web/src/invitation/accept-invitation\.ts`,
        "docs/qa/manual-regression.md",
      ),
    ).toEqual([]);
    const result = spawnSync("bun", ["test", "src/__tests__/manual-regression-triggers.test.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });
});

type OxlintRule = {
  readonly scope: string;
  readonly value: string;
  readonly category: string;
  readonly type_aware: boolean;
};

const oxlintRules = (): OxlintRule[] => {
  const result = spawnSync(join(REPO_ROOT, "node_modules/.bin/oxlint"), ["--rules", "--format", "json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return JSON.parse(result.stdout);
};

const typeAwareRuleNames = () =>
  new Set(oxlintRules().filter((rule) => rule.type_aware).map((rule) => rule.value));

const ruleNameOf = (key: string) => key.split("/").at(-1) ?? key;

type RuleSetting = string | number | readonly unknown[];

const isOff = (setting: RuleSetting) => {
  const level = Array.isArray(setting) ? setting[0] : setting;
  return level === "off" || level === 0 || level === "allow";
};

type OxlintConfig = {
  readonly categories?: Record<string, string>;
  readonly rules?: Record<string, RuleSetting>;
  readonly overrides?: ReadonlyArray<{ readonly rules?: Record<string, RuleSetting> }>;
};

const enabledTypeAwareRules = (): string[] => {
  const config: OxlintConfig = JSON.parse(read(".oxlintrc.json"));
  const rules = oxlintRules().filter((rule) => rule.type_aware);
  const typeAware = new Set(rules.map((rule) => rule.value));
  const topLevel = config.rules ?? {};
  const offAtTopLevel = new Set(
    Object.entries(topLevel)
      .filter(([, setting]) => isOff(setting))
      .map(([key]) => ruleNameOf(key)),
  );
  const byCategory = rules
    .filter(
      (rule) =>
        config.categories?.[rule.category] !== undefined &&
        config.categories[rule.category] !== "off" &&
        !offAtTopLevel.has(rule.value),
    )
    .map((rule) => rule.value);
  const explicit = [topLevel, ...(config.overrides ?? []).map((override) => override.rules ?? {})]
    .flatMap((ruleSettings) => Object.entries(ruleSettings))
    .filter(([key, setting]) => typeAware.has(ruleNameOf(key)) && !isOff(setting))
    .map(([key]) => ruleNameOf(key));
  return [...new Set([...byCategory, ...explicit])].sort();
};

const lintScriptOxlintArgs = (): string[] => {
  const { scripts }: { scripts: Record<string, string> } = JSON.parse(read("package.json"));
  const [command = "", ...args] = (scripts.lint ?? "").split("&&")[0]?.trim().split(/\s+/) ?? [];
  expect(command).toBe("oxlint");
  return args;
};

const typeAwareFixtureConfig = (): string => {
  const config: { jsPlugins?: Array<string | { name: string; specifier: string }> } = JSON.parse(
    read(".oxlintrc.json"),
  );
  const resolve = (specifier: string) =>
    specifier.startsWith(".") ? join(REPO_ROOT, specifier) : Bun.resolveSync(specifier, REPO_ROOT);
  const jsPlugins = (config.jsPlugins ?? []).map((plugin) =>
    typeof plugin === "string" ? resolve(plugin) : { ...plugin, specifier: resolve(plugin.specifier) },
  );
  return JSON.stringify({ ...config, jsPlugins });
};

const FLOATING_PROMISE_SOURCE = "export const probe = () => {\n  Promise.resolve(1);\n};\n";
const FLOATING_PROMISE_PATHS = ["web/src/FloatingPromiseProbe.ts", "src/FloatingPromiseProbe.ts"];

describe("型を使う lint", () => {
  test("AC-038: CI の check job の lint の oxlint の引数で、web/src と src の待たずに捨てた Promise を error にする", () => {
    const args = lintScriptOxlintArgs();
    const dir = mkdtempSync(join(tmpdir(), "acceptance-type-aware-397-"));
    try {
      writeFileSync(join(dir, ".oxlintrc.json"), typeAwareFixtureConfig());
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: "ES2023",
            module: "esnext",
            moduleResolution: "bundler",
            skipLibCheck: true,
            types: [],
          },
          include: ["**/*.ts"],
        }),
      );
      for (const path of FLOATING_PROMISE_PATHS) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), FLOATING_PROMISE_SOURCE);
      }
      const result = spawnSync(
        join(REPO_ROOT, "node_modules/.bin/oxlint"),
        [...args, "--format", "json", ...FLOATING_PROMISE_PATHS],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: 60_000,
          env: {
            ...process.env,
            OXLINT_TSGOLINT_PATH: join(REPO_ROOT, "node_modules/oxlint-tsgolint/bin/tsgolint.js"),
          },
        },
      );
      const report: { diagnostics: Array<Diagnostic & { code: string }> } = JSON.parse(
        result.stdout || '{"diagnostics":[]}',
      );
      const floatingErrors = report.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error" && diagnostic.code.includes("no-floating-promises"))
        .map((diagnostic) => diagnostic.filename)
        .sort();
      expect(floatingErrors).toEqual([...FLOATING_PROMISE_PATHS].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC-039: 有効にした型を使う rule ごとに、その名前が oxlint-rules.test.ts にあり、その試験が通る", () => {
    const enabled = enabledTypeAwareRules();
    expect(enabled.length).toBeGreaterThan(0);
    const ruleTests = read("src/__tests__/oxlint-rules.test.ts");
    expect(enabled.filter((rule) => !ruleTests.includes(rule))).toEqual([]);
    const result = spawnSync("bun", ["test", "./src/__tests__/oxlint-rules.test.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  test("AC-040: 型を使う rule を止める oxlint-disable の directive を、理由無しで書かない", () => {
    const typeAware = typeAwareRuleNames();
    const directives = gitGrep(
      "oxlint-disable",
      "src",
      "web",
      "db",
      "e2e",
      "testing",
      "management",
      "infra",
      "packages",
      "lint",
      "scripts",
    );
    const withoutReason = directives.filter((line) => {
      const directive = line.slice(line.indexOf("oxlint-disable"));
      const [rulesPart = ""] = directive.split(" -- ");
      const namesTypeAwareRule = rulesPart
        .split(/[\s,]+/)
        .some((token) => typeAware.has(ruleNameOf(token)));
      return namesTypeAwareRule && !directive.includes(" -- ");
    });
    expect(withoutReason).toEqual([]);
  });
});
