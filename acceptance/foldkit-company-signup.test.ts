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

const isTestPath = (path: string) => path.includes("/__tests__/") || /\.test\.tsx?$/.test(path);

const COMPANY_PAGE_DIR = "web/src/company/pages";

const importsFoldkit = (source: string) => /from\s+["']foldkit(\/[^"']*)?["']/.test(source);

const companyFoldkitPages = (): string[] =>
  gitFiles(`${COMPANY_PAGE_DIR}/*.ts`).filter((path) => {
    const source = read(path);
    return importsFoldkit(source) && /export const update\b/.test(source);
  });

const ALLOWED_REDIRECT = "https://app.taimei-code.com/";
const DISALLOWED_REDIRECT = "https://evil.example.com/";
const AUTH_ORIGIN = "https://auth.taimei-code.com";

const companySignupSearch = (redirectUrl: string) =>
  new URLSearchParams({ service_name: "taimei", redirect_url: redirectUrl }).toString();

type RuntimeForPathModule = { runtimeForPath: (pathname: string) => string };

const loadRuntimeForPath = async (): Promise<RuntimeForPathModule> =>
  import(join(REPO_ROOT, "web/src/app/runtime-for-path.ts"));

type AuthApplication = {
  init: (url: unknown) => { readonly model: unknown };
  update: (model: unknown, message: unknown) => { readonly model: unknown };
  view: (model: unknown, h: unknown) => unknown;
};

type Assertion = {
  toExist: () => unknown;
  toBeAbsent: () => unknown;
};

type SceneModule = {
  scene: (config: { update: unknown; view: unknown }, ...steps: unknown[]) => void;
  given: (model: unknown) => unknown;
  expect: (locator: unknown) => Assertion;
  role: (role: string, options?: { name: string }) => unknown;
  label: (text: string) => unknown;
  text: (text: string) => unknown;
};

const loadApplication = async () => {
  const application: AuthApplication = await import(join(REPO_ROOT, "web/src/app/auth/main.ts"));
  const Scene: SceneModule = await import("foldkit/scene");
  const Url: { fromString: (href: string) => { _tag: string; value?: unknown } } = await import(
    "foldkit/url"
  );
  const modelAt = (href: string) => {
    const url = Url.fromString(href);
    if (url._tag !== "Some") {
      throw new Error(`URL として読めない: ${href}`);
    }
    return application.init(url.value).model;
  };
  const sceneAt = (href: string, ...steps: (scene: SceneModule) => unknown[]) =>
    Scene.scene(
      { update: application.update, view: application.view },
      Scene.given(modelAt(href)),
      ...steps.flatMap((step) => step(Scene)),
    );
  return { sceneAt };
};

const checkingBeforeForm = (Scene: SceneModule) => [
  Scene.expect(Scene.role("status")).toExist(),
  Scene.expect(Scene.label("事業所名")).toBeAbsent(),
  Scene.expect(Scene.role("button", { name: "事業所を作成" })).toBeAbsent(),
];

describe("事業所の登録の画面は Foldkit の runtime で出る", () => {
  test.each(["/auth/signup/company", "/auth/signup/company/"])(
    "AC-001: %s の document では Foldkit の runtime が選ばれる",
    async (pathname) => {
      const { runtimeForPath } = await loadRuntimeForPath();
      expect(runtimeForPath(pathname)).toBe("FoldkitAuth");
    },
  );

  test.each(["/auth/signup/company/extra"])(
    "AC-002: %s の document では React の runtime が選ばれる",
    async (pathname) => {
      const { runtimeForPath } = await loadRuntimeForPath();
      expect(runtimeForPath(pathname)).toBe("React");
    },
  );

  test("AC-003: 開いた直後は確認の間の status だけを出し、事業所名の入力欄と作成のボタンを出さない", async () => {
    const { sceneAt } = await loadApplication();
    sceneAt(
      `${AUTH_ORIGIN}/auth/signup/company?${companySignupSearch(ALLOWED_REDIRECT)}`,
      checkingBeforeForm,
    );
  });

  test.each([
    ["許可されない redirect_url", `?${companySignupSearch(DISALLOWED_REDIRECT)}`],
    ["search の無い URL", ""],
  ])(
    "AC-004: %s で開いても、エラー画面でなく確認の間の status を出す",
    async (_, search) => {
      const { sceneAt } = await loadApplication();
      sceneAt(`${AUTH_ORIGIN}/auth/signup/company${search}`, (Scene) => [
        ...checkingBeforeForm(Scene),
        Scene.expect(Scene.text("不正なリダイレクト URL")).toBeAbsent(),
        Scene.expect(Scene.text("エラーが発生しました")).toBeAbsent(),
      ]);
    },
  );

  test("AC-005: auth-client が組む事業所作成画面の URL は、Foldkit の application が確認の間の status を出す", async () => {
    const { buildCompanySignupUrl } = await import("@taimei-code/auth-client");
    const url = buildCompanySignupUrl({
      authBaseUrl: AUTH_ORIGIN,
      service: "taimei",
      returnTo: ALLOWED_REDIRECT,
    });
    const { runtimeForPath } = await loadRuntimeForPath();
    expect(runtimeForPath(new URL(url).pathname)).toBe("FoldkitAuth");
    const { sceneAt } = await loadApplication();
    sceneAt(url, checkingBeforeForm);
  });
});

describe("移した画面の React の code", () => {
  test("AC-007: web/src に React の事業所の登録の code を書かない", () => {
    expect(
      gitGrep(
        String.raw`getRouteApi\("/auth/signup/company"\)|\b(readCompanySignupEntry|companySignupEntryOf)\b|path: "/signup/company"`,
        "web/src",
      ),
    ).toEqual([]);
  });
});

type LintCase = { readonly path: string; readonly source: string };

const LINT_CASES = {
  rawButtonInCompanyPage: {
    path: "web/src/company/pages/RawButtonProbe.ts",
    source:
      'import type { HtmlBuilder } from "foldkit/html";\nexport const view = <M>(h: HtmlBuilder<M>) => h.button([], ["x"]);\n',
  },
  moduleLetInCompanyPage: {
    path: "web/src/company/pages/ModuleLetProbe.ts",
    source: 'import { Command } from "foldkit";\nexport let counter = 0;\nexport { Command };\n',
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
    ["--format", "json", ...targets],
    { cwd, encoding: "utf8" },
  );
  const report: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  return report.diagnostics;
};

beforeAll(() => {
  lintFixtureDir = mkdtempSync(join(tmpdir(), "acceptance-oxlint-402-"));
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

describe("oxlint は事業所の登録の page に効く", () => {
  test("AC-008: company の pages の h.button を error にする", () => {
    expect(fixtureErrors(LINT_CASES.rawButtonInCompanyPage)).toBeGreaterThan(0);
  });

  test("AC-009: company の pages に Foldkit の page があり、lint の error が無く、同じ dir の module の let は error になる", () => {
    const pages = companyFoldkitPages();
    expect(pages.length).toBeGreaterThan(0);
    const pageErrors = new Map<string, number>();
    countErrors(oxlintJson(REPO_ROOT, ...pages), pageErrors);
    expect([...pageErrors.entries()]).toEqual([]);
    expect(fixtureErrors(LINT_CASES.moduleLetInCompanyPage)).toBeGreaterThan(0);
  });
});

describe("house の部品の外の素の要素", () => {
  test("AC-010: web/src の shared/ui の外の test 以外の file に h.button・h.input・h.textarea・h.select を書かない", () => {
    const hits = gitGrep(
      String.raw`\bh\.(button|input|textarea|select)\(`,
      "web/src/app",
      "web/src/auth",
      "web/src/mfa",
      "web/src/account",
      "web/src/company",
      "web/src/invitation",
      "web/src/membership",
      ":(glob)web/src/shared/*.ts",
      ":(glob)web/src/*.ts",
    );
    expect(hits.filter((line) => !isTestPath(line.split(":")[0] ?? ""))).toEqual([]);
  });
});

const storyAndSceneTestsOf = (page: string) => {
  const name = basename(page, ".ts");
  const testsDir = join(dirname(dirname(page)), "__tests__");
  return {
    story: join(testsDir, `${name}.story.test.ts`),
    scene: join(testsDir, `${name}.scene.test.ts`),
  };
};

const testNamesIn = (path: string): string[] =>
  [...read(path).matchAll(/\btest(?:\.each\([\s\S]*?\))?\(\s*["'`]([^"'`]+)["'`]/g)].map(
    ([, name]) => name ?? "",
  );

describe("page ごとの Story テストと Scene テスト", () => {
  test("AC-011: company の Foldkit の page ごとに、同じ domain の __tests__ に Story テストと Scene テストがあり、bun test で通る", () => {
    const pages = companyFoldkitPages();
    expect(pages.length).toBeGreaterThan(0);
    const tests = pages.flatMap((page) => {
      const { story, scene } = storyAndSceneTestsOf(page);
      return [story, scene];
    });
    expect(tests.filter((path) => !existsSync(join(REPO_ROOT, path)))).toEqual([]);
    const result = spawnSync("bun", ["test", ...tests.map((path) => `./${path}`)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  test("AC-012: company の page の Story テストは、二重の操作と古い応答の test を持つ", () => {
    const pages = companyFoldkitPages();
    expect(pages.length).toBeGreaterThan(0);
    const names = pages
      .map((page) => storyAndSceneTestsOf(page).story)
      .filter((path) => existsSync(join(REPO_ROOT, path)))
      .flatMap(testNamesIn);
    expect(names.filter((name) => name.includes("二重"))).not.toEqual([]);
    expect(names.filter((name) => name.includes("古い"))).not.toEqual([]);
  });
});

describe("Foldkit の書き方", () => {
  test("AC-013: company の pages に Effect.die・Effect.orDie を書かない", () => {
    expect(gitGrep(String.raw`\bEffect\.(die|orDie)\b`, COMPANY_PAGE_DIR)).toEqual([]);
  });

  test("AC-014: company の Foldkit の page は Model・Message・init・update・view を直接 export し、domain に index.ts が無い", () => {
    const pages = companyFoldkitPages();
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const source = read(page);
      for (const name of ["Model", "Message", "init", "update", "view"]) {
        expect(source).toMatch(new RegExp(String.raw`export const ${name}\b`));
      }
    }
    expect(gitFiles("web/src/company/index.ts")).toEqual([]);
  });

  test("AC-015: web/src に page や application を作る独自の関数を書かない", () => {
    expect(
      gitGrep(String.raw`\b(definePage|defineElement|startRoutingApplication)\b`, "web/src"),
    ).toEqual([]);
  });
});

describe("手動回帰の契機", () => {
  test("AC-016: 契機の path は消した React の事業所の登録の file を挙げず、契機の検査が通る", () => {
    expect(
      gitGrep(
        String.raw`web/src/company/pages/SignUpCompany\.tsx|web/src/company/company-signup-entry\.ts`,
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
