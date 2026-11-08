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

const PAGE_DIRS = ["web/src/auth/pages", "web/src/mfa/pages"] as const;

const importsFoldkit = (source: string) => /from\s+["']foldkit(\/[^"']*)?["']/.test(source);

const foldkitPagesIn = (dir: string): string[] =>
  gitFiles(`${dir}/*.ts`).filter((path) => {
    const source = read(path);
    return importsFoldkit(source) && /export const update\b/.test(source);
  });

const ALLOWED_REDIRECT = "https://app.taimei-code.com/";
const DISALLOWED_REDIRECT = "https://evil.example.com/";
const AUTH_ORIGIN = "https://auth.taimei-code.com";

const signInSearch = (redirectUrl: string) =>
  new URLSearchParams({ service_name: "taimei", redirect_url: redirectUrl }).toString();

type RuntimeForPathModule = { runtimeForPath: (pathname: string) => string };

const loadRuntimeForPath = async (): Promise<RuntimeForPathModule> =>
  import(join(REPO_ROOT, "web/src/app/runtime-for-path.ts"));

describe("runtime は URL の path だけで選ばれる", () => {
  test.each(["/auth", "/auth/", "/auth/signup", "/auth/signup/", "/auth/mfa", "/auth/error"])(
    "AC-001: %s の document では Foldkit の runtime が選ばれる",
    async (pathname) => {
      const { runtimeForPath } = await loadRuntimeForPath();
      expect(runtimeForPath(pathname)).toBe("FoldkitAuth");
    },
  );

  test.each([
    "/auth/errors",
    "/auth/mfa/extra",
  ])("AC-002: %s の document では React の runtime が選ばれる", async (pathname) => {
    const { runtimeForPath } = await loadRuntimeForPath();
    expect(runtimeForPath(pathname)).toBe("React");
  });
});

type AuthApplication = {
  init: (url: unknown) => { readonly model: unknown };
  update: (model: unknown, message: unknown) => { readonly model: unknown };
  view: (model: unknown, h: unknown) => unknown;
};

type Assertion = {
  toExist: () => unknown;
  toBeAbsent: () => unknown;
  toBeDisabled: () => unknown;
  toBeEnabled: () => unknown;
  toHaveAttr: (name: string, value: string) => unknown;
};

type SceneModule = {
  scene: (config: { update: unknown; view: unknown }, ...steps: unknown[]) => void;
  given: (model: unknown) => unknown;
  expect: (locator: unknown) => Assertion;
  role: (role: string, options?: { name: string }) => unknown;
  label: (text: string) => unknown;
  text: (text: string) => unknown;
  type: (locator: unknown, value: string) => unknown;
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

const button = (Scene: SceneModule, name: string) => Scene.role("button", { name });

describe("共通ログイン画面と共通サインアップ画面は Foldkit で今と同じ文言を出す", () => {
  test.each(["/auth", "/auth/"])(
    "AC-003: %s のログイン画面は見出し、説明、入力欄、2 つのボタン、URL の注意を出す",
    async (path) => {
      const { sceneAt } = await loadApplication();
      sceneAt(`${AUTH_ORIGIN}${path}?${signInSearch(ALLOWED_REDIRECT)}`, (Scene) => [
        Scene.expect(Scene.text("taimei にログイン")).toExist(),
        Scene.expect(Scene.text("Magic Link または GitHub アカウントでログイン")).toExist(),
        Scene.expect(Scene.label("メールアドレス")).toExist(),
        Scene.expect(button(Scene, "Magic Link を送信")).toExist(),
        Scene.expect(button(Scene, "GitHub でログイン")).toExist(),
        Scene.expect(Scene.text("URL が auth.taimei-code.com であることを確認してください")).toExist(),
      ]);
    },
  );

  test("AC-004: 新規登録画面は見出し、説明、お名前とメールアドレスの入力欄、2 つのボタンを出す", async () => {
    const { sceneAt } = await loadApplication();
    sceneAt(`${AUTH_ORIGIN}/auth/signup?${signInSearch(ALLOWED_REDIRECT)}`, (Scene) => [
      Scene.expect(Scene.text("taimei に登録")).toExist(),
      Scene.expect(Scene.text("Magic Link または GitHub で新規登録")).toExist(),
      Scene.expect(Scene.label("お名前")).toExist(),
      Scene.expect(Scene.label("メールアドレス")).toExist(),
      Scene.expect(button(Scene, "Magic Link で登録")).toExist(),
      Scene.expect(button(Scene, "GitHub で登録")).toExist(),
    ]);
  });

  test("AC-005: ログイン画面と新規登録画面の間の link は、宣言した search だけを引き継ぐ", async () => {
    const { sceneAt } = await loadApplication();
    const declared = signInSearch(ALLOWED_REDIRECT);
    sceneAt(`${AUTH_ORIGIN}/auth?${declared}&error=signin_failed`, (Scene) => [
      Scene.expect(Scene.role("link", { name: "新規登録" })).toHaveAttr(
        "href",
        `/auth/signup?${declared}`,
      ),
    ]);
    sceneAt(`${AUTH_ORIGIN}/auth/signup?${declared}&error=signin_failed`, (Scene) => [
      Scene.expect(Scene.role("link", { name: "ログイン" })).toHaveAttr("href", `/auth?${declared}`),
    ]);
  });

  test("AC-006: 招待の token の付いたログイン画面は GitHub のボタンを出さず、招待の案内を出す", async () => {
    const { sceneAt } = await loadApplication();
    const search = new URLSearchParams({
      service_name: "taimei",
      redirect_url: ALLOWED_REDIRECT,
      invitation_token: "e2e-invitation-token",
    }).toString();
    sceneAt(`${AUTH_ORIGIN}/auth/?${search}`, (Scene) => [
      Scene.expect(button(Scene, "Magic Link を送信")).toExist(),
      Scene.expect(button(Scene, "GitHub でログイン")).toBeAbsent(),
      Scene.expect(
        Scene.text("招待を受諾するには、招待されたメールアドレスで Magic Link をご利用ください。"),
      ).toExist(),
    ]);
  });

  test("AC-007: 送信のボタンは、必要な入力が空の間は無効で、入れると有効になる", async () => {
    const { sceneAt } = await loadApplication();
    sceneAt(`${AUTH_ORIGIN}/auth?${signInSearch(ALLOWED_REDIRECT)}`, (Scene) => [
      Scene.expect(button(Scene, "Magic Link を送信")).toBeDisabled(),
      Scene.type(Scene.label("メールアドレス"), "user@example.com"),
      Scene.expect(button(Scene, "Magic Link を送信")).toBeEnabled(),
    ]);
    sceneAt(`${AUTH_ORIGIN}/auth/signup?${signInSearch(ALLOWED_REDIRECT)}`, (Scene) => [
      Scene.expect(button(Scene, "Magic Link で登録")).toBeDisabled(),
      Scene.type(Scene.label("お名前"), "山田 太郎"),
      Scene.expect(button(Scene, "Magic Link で登録")).toBeDisabled(),
      Scene.type(Scene.label("メールアドレス"), "user@example.com"),
      Scene.expect(button(Scene, "Magic Link で登録")).toBeEnabled(),
    ]);
  });

  test.each([
    ["/auth", "Magic Link を送信"],
    ["/auth/signup", "Magic Link で登録"],
  ])(
    "AC-008: 許可されない redirect_url の %s は入力欄と送信のボタンを出さない (許可された URL では出す)",
    async (path, submitName) => {
      const { sceneAt } = await loadApplication();
      sceneAt(`${AUTH_ORIGIN}${path}?${signInSearch(ALLOWED_REDIRECT)}`, (Scene) => [
        Scene.expect(button(Scene, submitName)).toExist(),
      ]);
      sceneAt(`${AUTH_ORIGIN}${path}?${signInSearch(DISALLOWED_REDIRECT)}`, (Scene) => [
        Scene.expect(button(Scene, submitName)).toBeAbsent(),
        Scene.expect(Scene.label("メールアドレス")).toBeAbsent(),
      ]);
    },
  );
});

describe("MFA チャレンジの画面は Foldkit で出る", () => {
  test("AC-009: /auth/mfa を開いた直後は status だけを出し、確認コードの入力欄とボタンを出さない", async () => {
    const { sceneAt } = await loadApplication();
    sceneAt(`${AUTH_ORIGIN}/auth/mfa`, (Scene) => [
      Scene.expect(Scene.role("status")).toExist(),
      Scene.expect(button(Scene, "ログインを続ける")).toBeAbsent(),
      Scene.expect(Scene.label("確認コード")).toBeAbsent(),
    ]);
  });
});

describe("house の部品と、部品の外の素の要素", () => {
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

  test("AC-013: shared/ui に @foldkit/ui を import して button・input・label の要素を描く file がある", () => {
    const parts = gitFiles(":(glob)web/src/shared/ui/*.ts")
      .map(read)
      .filter((source) => /from\s+["']@foldkit\/ui["']/.test(source));
    const drawn = parts.join("\n");
    expect(parts.length).toBeGreaterThan(0);
    expect(drawn).toMatch(/\bh\.button\(/);
    expect(drawn).toMatch(/\bh\.input\(/);
    expect(drawn).toMatch(/\bh\.label\(/);
  });
});

type LintCase = { readonly path: string; readonly source: string };

const LINT_CASES = {
  rawButtonInAuthPage: {
    path: "web/src/auth/pages/RawButtonProbe.ts",
    source:
      'import type { HtmlBuilder } from "foldkit/html";\nexport const view = <M>(h: HtmlBuilder<M>) => h.button([], ["x"]);\n',
  },
  rawButtonInMfaPage: {
    path: "web/src/mfa/pages/RawButtonProbe.ts",
    source:
      'import type { HtmlBuilder } from "foldkit/html";\nexport const view = <M>(h: HtmlBuilder<M>) => h.button([], ["x"]);\n',
  },
  rawButtonInSharedUi: {
    path: "web/src/shared/ui/raw-button-probe.ts",
    source:
      'import type { HtmlBuilder } from "foldkit/html";\nexport const view = <M>(h: HtmlBuilder<M>) => h.button([], ["x"]);\n',
  },
  moduleLetInAuthPage: {
    path: "web/src/auth/pages/ModuleLetProbe.ts",
    source: 'import { Command } from "foldkit";\nexport let counter = 0;\nexport { Command };\n',
  },
  moduleLetInMfaPage: {
    path: "web/src/mfa/pages/ModuleLetProbe.ts",
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
  lintFixtureDir = mkdtempSync(join(tmpdir(), "acceptance-oxlint-389-"));
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

describe("oxlint は移した画面の code に効く", () => {
  test("AC-011: auth と mfa の pages の h.button を error にし、shared/ui の同じ code は通す", () => {
    expect(fixtureErrors(LINT_CASES.rawButtonInAuthPage)).toBeGreaterThan(0);
    expect(fixtureErrors(LINT_CASES.rawButtonInMfaPage)).toBeGreaterThan(0);
    expect(fixtureErrors(LINT_CASES.rawButtonInSharedUi)).toBe(0);
  });

  test("AC-012: auth と mfa の pages に Foldkit の page があり、lint の error が無く、同じ dir の module の let は error になる", () => {
    for (const dir of PAGE_DIRS) {
      expect(foldkitPagesIn(dir).length).toBeGreaterThan(0);
    }
    const pages = PAGE_DIRS.flatMap(foldkitPagesIn);
    const pageErrors = new Map<string, number>();
    countErrors(oxlintJson(REPO_ROOT, ...pages), pageErrors);
    expect([...pageErrors.entries()]).toEqual([]);
    expect(fixtureErrors(LINT_CASES.moduleLetInAuthPage)).toBeGreaterThan(0);
    expect(fixtureErrors(LINT_CASES.moduleLetInMfaPage)).toBeGreaterThan(0);
  });
});

describe("移した画面の React の code と test", () => {
  test("AC-014: web/src に移した画面の React の code を書かない", () => {
    expect(
      gitGrep(
        String.raw`getRouteApi\("/auth/(signup|mfa)?"\)|\b(useSignPage|useMfaChallengeFlow|MfaChallengeView|AuthPageCard|SocialSignInSection|CanaryTokens)\b`,
        "web/src",
      ),
    ).toEqual([]);
  });

  test("AC-015: web/src/app の TanStack Router の route に /signup と /mfa を書かない", () => {
    expect(gitGrep(String.raw`path: "/(signup|mfa)"`, "web/src/app")).toEqual([]);
  });

  test("AC-016: QA-MR-08 の契機の path は MFA の pages の実在する file を挙げ、消した React の file を挙げず、契機の検査が通る", () => {
    const section = read("docs/qa/manual-regression.md").split(/^## /m).find((part) =>
      part.startsWith("QA-MR-08:"),
    );
    const triggerLine = /^- \*\*契機の path\*\*: (.+)$/m.exec(section ?? "")?.[1] ?? "";
    const globs = [...triggerLine.matchAll(/`([^`]+)`/g)].map(([, glob]) => glob ?? "");
    expect(globs.filter((glob) => /MfaChallenge\.tsx|MfaChallengeView\.tsx/.test(glob))).toEqual([]);
    expect(
      globs.filter((glob) => glob.startsWith("web/src/mfa/pages/") && existsSync(join(REPO_ROOT, glob))),
    ).not.toEqual([]);
    const result = spawnSync("bun", ["test", "src/__tests__/manual-regression-triggers.test.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
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
  test("AC-017: Foldkit の page ごとに、同じ domain の __tests__ に Story テストと Scene テストがあり、bun test で通る", () => {
    const pages = PAGE_DIRS.flatMap(foldkitPagesIn);
    for (const dir of PAGE_DIRS) {
      expect(foldkitPagesIn(dir).length).toBeGreaterThan(0);
    }
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

  test("AC-018: auth と mfa の page の Story テストは、二重の操作と古い応答の test を持つ", () => {
    for (const dir of PAGE_DIRS) {
      const pages = foldkitPagesIn(dir);
      expect(pages.length).toBeGreaterThan(0);
      const names = pages
        .map((page) => storyAndSceneTestsOf(page).story)
        .filter((path) => existsSync(join(REPO_ROOT, path)))
        .flatMap(testNamesIn);
      expect(names.filter((name) => name.includes("二重"))).not.toEqual([]);
      expect(names.filter((name) => name.includes("古い"))).not.toEqual([]);
    }
  });
});

describe("Foldkit の書き方", () => {
  test("AC-019: auth と mfa の pages に Effect.die・Effect.orDie を書かない", () => {
    expect(gitGrep(String.raw`\bEffect\.(die|orDie)\b`, ...PAGE_DIRS)).toEqual([]);
  });

  test("AC-020: web/src に page や application を作る独自の関数を書かない", () => {
    expect(
      gitGrep(String.raw`\b(definePage|defineElement|startRoutingApplication)\b`, "web/src"),
    ).toEqual([]);
  });

  test("AC-021: auth と mfa の Foldkit の page は Model・Message・init・update・view を直接 export し、domain に index.ts が無い", () => {
    for (const dir of PAGE_DIRS) {
      const pages = foldkitPagesIn(dir);
      expect(pages.length).toBeGreaterThan(0);
      for (const page of pages) {
        const source = read(page);
        for (const name of ["Model", "Message", "init", "update", "view"]) {
          expect(source).toMatch(new RegExp(String.raw`export const ${name}\b`));
        }
      }
    }
    expect(gitFiles("web/src/auth/index.ts", "web/src/mfa/index.ts")).toEqual([]);
  });

  test("AC-022: web/src に redirect の許可の検査を書かない", () => {
    expect(gitGrep(String.raw`validateRedirectUrl|url-allowlist`, "web/src")).toEqual([]);
  });
});

describe("Foldkit の skill を使う指示", () => {
  test("AC-023: web/src/CLAUDE.md は Foldkit の skill を読み込む指示と、サブエージェントを起動しない指示を持つ", () => {
    const guide = read("web/src/CLAUDE.md");
    for (const skill of ["foldkit", "generate-program", "audit-program"]) {
      expect(guide).toContain(`\`${skill}\``);
    }
    expect(guide).toContain(".claude/skills/");
    expect(guide).toContain("サブエージェント");
  });

  test("AC-024: ADR-0023 は web/src/CLAUDE.md に skill を読み込む指示を置くことを書く", () => {
    const adr = read("docs/adr/0023-web-foldkit.md");
    expect(adr).toMatch(/`web\/src\/CLAUDE\.md`[^\n]*skill を読み込む/);
  });
});
