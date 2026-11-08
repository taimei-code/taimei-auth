import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

const ERROR_MESSAGES = {
  signin_failed: {
    title: "ログインに失敗しました",
    description: "ログイン処理中にエラーが発生しました。再度お試しください。",
  },
  signup_already_completed: {
    title: "サインアップ済みです",
    description: "既に登録済みのアカウントです。ログイン画面からログインしてください。",
  },
  invalid_redirect_url: {
    title: "不正なリダイレクト URL",
    description:
      "リダイレクト先が許可されていません。ログインリクエストを発行したサービスから再度ログインしてください。",
  },
} as const;

const DEFAULT_MESSAGE = {
  title: "エラーが発生しました",
  description: "予期せぬエラーが発生しました。時間を置いて再度お試しください。",
};

describe("runtime は URL の path だけで選ばれる", () => {
  test("AC-043: entry と runtime の選択は build の mode や環境の値を読まない", () => {
    expect(gitGrep(String.raw`import\.meta\.env`, "web/src/main.ts", "web/src/app/runtime-for-path.ts")).toEqual(
      [],
    );
  });
});

type ViewDocument = { readonly title: string; readonly canonical?: string; readonly ogUrl?: string };

type AuthApplication = {
  init: (url: unknown) => { readonly model: unknown };
  update: (model: unknown, message: unknown) => { readonly model: unknown };
  view: (model: unknown, h: unknown) => ViewDocument;
};

type SceneModule = {
  scene: (
    config: { update: AuthApplication["update"]; view: (model: unknown, h: unknown) => unknown },
    ...steps: unknown[]
  ) => void;
  given: (model: unknown) => unknown;
  expect: (locator: unknown) => {
    toContainText: (text: string) => unknown;
    toExist: () => unknown;
  };
  role: (role: string) => unknown;
  within: (parent: unknown, child: unknown) => unknown;
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
  const expectAlertTexts = (href: string, texts: readonly string[]) =>
    Scene.scene(
      { update: application.update, view: application.view },
      Scene.given(modelAt(href)),
      Scene.expect(Scene.role("alert")).toExist(),
      ...texts.map((text) => Scene.expect(Scene.role("alert")).toContainText(text)),
    );
  const documentAt = (href: string): ViewDocument => {
    const rendered: ViewDocument[] = [];
    Scene.scene(
      {
        update: application.update,
        view: (model, h) => {
          const document = application.view(model, h);
          rendered.push(document);
          return document;
        },
      },
      Scene.given(modelAt(href)),
    );
    const [first] = rendered;
    if (first === undefined) {
      throw new Error("view が描かれなかった");
    }
    return first;
  };
  return { expectAlertTexts, documentAt };
};

describe("エラー画面は Foldkit で今と同じ文言を出す", () => {
  test.each(Object.entries(ERROR_MESSAGES))(
    "AC-003: 理由 %s は今と同じ title と description を alert の中に出す",
    async (reason, message) => {
      const { expectAlertTexts } = await loadApplication();
      expectAlertTexts(`https://auth.example.com/auth/error?reason=${reason}`, [
        message.title,
        message.description,
      ]);
    },
  );

  test.each([
    ["定義外の理由", "https://auth.example.com/auth/error?reason=bogus"],
    ["理由なし", "https://auth.example.com/auth/error"],
  ])("AC-004: %s は既定の文言を出す", async (_label, href) => {
    const { expectAlertTexts } = await loadApplication();
    expectAlertTexts(href, [DEFAULT_MESSAGE.title, DEFAULT_MESSAGE.description]);
  });

  test("AC-005: エラー画面の document の title は taimei-auth で、canonical と og:url を持たない", async () => {
    const { documentAt } = await loadApplication();
    const document = documentAt("https://auth.example.com/auth/error?reason=signin_failed");
    expect(document.title).toBe("taimei-auth");
    expect(document.canonical).toBeUndefined();
    expect(document.ogUrl).toBeUndefined();
    expect(read("web/index.html")).toContain("<title>taimei-auth</title>");
    expect(read("web/index.html")).not.toMatch(/canonical|og:url/);
  });
});

describe("エラー画面へ入る遷移と、消した React の code", () => {
  test("AC-007: web/src/app の router に /auth/error へ SPA の遷移で入る redirect を書かない", () => {
    expect(gitGrep(`to: "/auth/error"`, ":(glob)web/src/app/*.tsx")).toEqual([]);
  });

  test("AC-036: React のエラー画面の route が使っていた zod の search の schema を書かず、Error.tsx は残す", () => {
    expect(gitGrep("authErrorSearchSchema", "web/src")).toEqual([]);
    expect(existsSync(join(REPO_ROOT, "web/src/auth/pages/Error.tsx"))).toBe(true);
  });

  test("AC-028: foldkit/navigation の load による document の読み直しは shared/leave-spa.ts の外に書かない", () => {
    const loads = gitGrep(
      String.raw`Navigation\.load\(|import[^;]*[{ ,]load[ ,}][^;]*from "foldkit/navigation"`,
      "web/src",
    ).filter((line) => !isTestPath(line) && !line.startsWith("web/src/shared/leave-spa.ts:"));
    expect(loads).toEqual([]);
  });
});

describe("application の起動の設定", () => {
  test("AC-009: makeApplication を呼ぶ web/src の file はすべて devTools: false を持つ", () => {
    const starters = gitFiles("web/src").filter(
      (path) => !isTestPath(path) && /\bmakeApplication\(/.test(read(path)),
    );
    expect(starters.length).toBeGreaterThan(0);
    expect(starters.filter((path) => !/\bdevTools: false\b/.test(read(path)))).toEqual([]);
  });

  test("AC-030: web/src/app/*/entry.ts はすべて resources を渡す", () => {
    const entries = gitFiles(":(glob)web/src/app/*/entry.ts");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((path) => !/\bresources\b/.test(read(path)))).toEqual([]);
  });
});

type LintCase = { readonly path: string; readonly source: string };

const LINT_CASES = {
  effectRun: {
    path: "web/src/mfa/run-effect.ts",
    source: 'import { Effect } from "effect";\nexport const run = () => Effect.runPromise(Effect.void);\n',
  },
  effectRunClean: {
    path: "web/src/mfa/run-effect-clean.ts",
    source: 'import { Effect } from "effect";\nexport const run = () => Effect.void;\n',
  },
  windowInView: {
    path: "web/src/mfa/window-in-view.ts",
    source:
      'import { Command } from "foldkit";\nexport const view = () => [window.location.href, Command];\n',
  },
  windowInCommand: {
    path: "web/src/mfa/window-in-command.ts",
    source:
      'import { Effect } from "effect";\nimport { Command } from "foldkit";\nexport const ScrollToTop = Command.define("ScrollToTop", {\n  messages: [],\n  execute: Effect.sync(() => window.scrollTo(0, 0)),\n});\n',
  },
  setTimeoutInFoldkit: {
    path: "web/src/mfa/set-timeout.ts",
    source:
      'import { Command } from "foldkit";\nexport const later = () => [setTimeout(() => undefined, 1), Command];\n',
  },
  dateNowInFoldkit: {
    path: "web/src/mfa/date-now.ts",
    source: 'import { Command } from "foldkit";\nexport const now = () => [Date.now(), Command];\n',
  },
  mathRandomInFoldkit: {
    path: "web/src/mfa/math-random.ts",
    source: 'import { Command } from "foldkit";\nexport const pick = () => [Math.random(), Command];\n',
  },
  timeClean: {
    path: "web/src/mfa/time-clean.ts",
    source: 'import { Command } from "foldkit";\nexport const now = () => [0, Command];\n',
  },
  atomImport: {
    path: "web/src/mfa/atom-import.ts",
    source:
      'import { Command } from "foldkit";\nimport { mfaStatusAtom } from "./mfa-atom";\nexport { Command, mfaStatusAtom };\n',
  },
  nonAtomImport: {
    path: "web/src/mfa/non-atom-import.ts",
    source:
      'import { Command } from "foldkit";\nimport { mfaStatus } from "./mfa-status";\nexport { Command, mfaStatus };\n',
  },
  rawButton: {
    path: "web/src/mfa/raw-button.ts",
    source:
      'type Builder = { readonly button: (attributes: unknown[], children: unknown[]) => unknown };\nexport const view = (h: Builder) => h.button([], []);\n',
  },
  rawInput: {
    path: "web/src/mfa/raw-input.ts",
    source:
      'type Builder = { readonly input: (attributes: unknown[]) => unknown };\nexport const view = (h: Builder) => h.input([]);\n',
  },
  rawTextarea: {
    path: "web/src/mfa/raw-textarea.ts",
    source:
      'type Builder = { readonly textarea: (attributes: unknown[], children: unknown[]) => unknown };\nexport const view = (h: Builder) => h.textarea([], []);\n',
  },
  rawSelect: {
    path: "web/src/mfa/raw-select.ts",
    source:
      'type Builder = { readonly select: (attributes: unknown[], children: unknown[]) => unknown };\nexport const view = (h: Builder) => h.select([], []);\n',
  },
  houseButton: {
    path: "web/src/shared/ui/house-button.ts",
    source:
      'type Builder = { readonly button: (attributes: unknown[], children: unknown[]) => unknown };\nexport const view = (h: Builder) => h.button([], []);\n',
  },
  makeApplicationInDomain: {
    path: "web/src/mfa/make-application.ts",
    source:
      'import { Runtime } from "foldkit";\nexport const make = (config: Parameters<typeof Runtime.makeApplication>[0]) => Runtime.makeApplication(config);\n',
  },
  runInDomain: {
    path: "web/src/mfa/run-application.ts",
    source:
      'import { Runtime } from "foldkit";\nexport const start = (program: Parameters<typeof Runtime.run>[0]) => Runtime.run(program);\n',
  },
  startClean: {
    path: "web/src/mfa/no-start.ts",
    source: 'import { Command } from "foldkit";\nexport { Command };\n',
  },
  atAlias: {
    path: "web/src/shared/at-alias.ts",
    source: 'import { cn } from "@/shared/utils";\nexport { cn };\n',
  },
  relativeImport: {
    path: "web/src/shared/relative-import.ts",
    source: 'import { cn } from "./utils";\nexport { cn };\n',
  },
  routeInDomain: {
    path: "web/src/mfa/route-in-domain.ts",
    source: 'import { Route } from "foldkit";\nexport { Route };\n',
  },
  routeModuleInDomain: {
    path: "web/src/mfa/route-module-in-domain.ts",
    source: 'import { literal } from "foldkit/route";\nexport { literal };\n',
  },
  routeInRouteFile: {
    path: "web/src/app/auth/route.ts",
    source:
      'import { Route } from "foldkit";\nimport { literal } from "foldkit/route";\nexport { literal, Route };\n',
  },
  sonnerInRouteFile: {
    path: "web/src/app/account/route.ts",
    source:
      'import { literal } from "foldkit/route";\nimport { toast } from "sonner";\nexport { literal, toast };\n',
  },
  ifWithoutBraces: {
    path: "web/src/shared/if-without-braces.ts",
    source: "export const sign = (value: number) => {\n  if (value > 0) return 1;\n  return -1;\n};\n",
  },
  ifWithBraces: {
    path: "web/src/shared/if-with-braces.ts",
    source:
      "export const sign = (value: number) => {\n  if (value > 0) {\n    return 1;\n  }\n  return -1;\n};\n",
  },
  castInSource: {
    path: "web/src/shared/cast.ts",
    source: "export const asText = (value: unknown) => value as string;\n",
  },
  castInTest: {
    path: "web/src/shared/__tests__/cast.ts",
    source: "export const asText = (value: unknown) => value as string;\n",
  },
  effectCrypto: {
    path: "web/src/shared/effect-crypto.ts",
    source: 'import { SecureRandom } from "effect/crypto";\nexport { SecureRandom };\n',
  },
  effectPersistence: {
    path: "web/src/shared/effect-persistence.ts",
    source: 'import { KeyValueStore } from "effect/persistence";\nexport { KeyValueStore };\n',
  },
  effectSql: {
    path: "web/src/shared/effect-sql.ts",
    source: 'import { SqlClient } from "effect/sql";\nexport { SqlClient };\n',
  },
  moduleLet: {
    path: "web/src/mfa/module-let.ts",
    source: 'import { Command } from "foldkit";\nexport let counter = 0;\nexport { Command };\n',
  },
  moduleConst: {
    path: "web/src/mfa/module-const.ts",
    source: 'import { Command } from "foldkit";\nexport const counter = 0;\nexport { Command };\n',
  },
  sonnerInFoldkit: {
    path: "web/src/mfa/sonner-in-foldkit.ts",
    source: 'import { Command } from "foldkit";\nimport { toast } from "sonner";\nexport { Command, toast };\n',
  },
} satisfies Record<string, LintCase>;

type Diagnostic = { readonly filename: string; readonly severity: string };

const lintErrorsByPath = new Map<string, number>();
let lintFixtureDir = "";

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

beforeAll(() => {
  lintFixtureDir = mkdtempSync(join(tmpdir(), "acceptance-oxlint-"));
  writeFileSync(join(lintFixtureDir, ".oxlintrc.json"), repoConfigForFixture());
  symlinkSync(join(REPO_ROOT, "node_modules"), join(lintFixtureDir, "node_modules"));
  for (const { path, source } of Object.values(LINT_CASES)) {
    mkdirSync(dirname(join(lintFixtureDir, path)), { recursive: true });
    writeFileSync(join(lintFixtureDir, path), source);
  }
  const result = spawnSync(
    join(REPO_ROOT, "node_modules/.bin/oxlint"),
    ["--format", "json", "web"],
    { cwd: lintFixtureDir, encoding: "utf8" },
  );
  const report: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  for (const diagnostic of report.diagnostics) {
    if (diagnostic.severity === "error") {
      lintErrorsByPath.set(diagnostic.filename, (lintErrorsByPath.get(diagnostic.filename) ?? 0) + 1);
    }
  }
});

afterAll(() => {
  if (lintFixtureDir !== "") {
    rmSync(lintFixtureDir, { recursive: true, force: true });
  }
});

const lintErrors = (lintCase: LintCase) => lintErrorsByPath.get(lintCase.path) ?? 0;

describe("oxlint は Foldkit の書き方から外れる code を止める", () => {
  test("AC-010: web/src の Effect.runPromise を error にし、実行を除いた file は通す", () => {
    expect(lintErrors(LINT_CASES.effectRun)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.effectRunClean)).toBe(0);
  });

  test("AC-011: Foldkit の file の Command の外の window を error にし、execute の Effect.sync の中は通す", () => {
    expect(lintErrors(LINT_CASES.windowInView)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.windowInCommand)).toBe(0);
  });

  test("AC-012: Foldkit の file の setTimeout・Date.now・Math.random を error にし、除いた file は通す", () => {
    expect(lintErrors(LINT_CASES.setTimeoutInFoldkit)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.dateNowInFoldkit)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.mathRandomInFoldkit)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.timeClean)).toBe(0);
  });

  test("AC-013: Foldkit の file からの *-atom の import を error にし、ほかの module の import は通す", () => {
    expect(lintErrors(LINT_CASES.atomImport)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.nonAtomImport)).toBe(0);
  });

  test("AC-014: shared/ui の外の h.button・h.input・h.textarea・h.select を error にし、shared/ui の中は通す", () => {
    expect(lintErrors(LINT_CASES.rawButton)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.rawInput)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.rawTextarea)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.rawSelect)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.houseButton)).toBe(0);
  });

  test("AC-015: domain の file の Runtime.makeApplication・Runtime.run を error にし、呼ばない file は通す", () => {
    expect(lintErrors(LINT_CASES.makeApplicationInDomain)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.runInDomain)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.startClean)).toBe(0);
  });

  test("AC-016: web/src の @/ の import を error にし、相対 import は通す", () => {
    expect(lintErrors(LINT_CASES.atAlias)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.relativeImport)).toBe(0);
  });

  test("AC-017: route の import は app/*/route.ts だけが書け、route.ts でも sonner は止まる", () => {
    expect(lintErrors(LINT_CASES.routeInDomain)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.routeModuleInDomain)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.routeInRouteFile)).toBe(0);
    expect(lintErrors(LINT_CASES.sonnerInRouteFile)).toBeGreaterThan(0);
  });

  test("AC-018: web/src の braces の無い if の本体を error にし、braces の有るものは通す", () => {
    expect(lintErrors(LINT_CASES.ifWithoutBraces)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.ifWithBraces)).toBe(0);
  });

  test("AC-019: web/src の test 以外の型の cast を error にし、__tests__ の同じ code は通す", () => {
    expect(lintErrors(LINT_CASES.castInSource)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.castInTest)).toBe(0);
  });

  test("AC-020: web/src の effect/crypto・effect/persistence の import を通し、effect/sql は error のまま", () => {
    expect(lintErrors(LINT_CASES.effectCrypto)).toBe(0);
    expect(lintErrors(LINT_CASES.effectPersistence)).toBe(0);
    expect(lintErrors(LINT_CASES.effectSql)).toBeGreaterThan(0);
  });

  test("AC-021: Foldkit の file の module の階層の let を error にし、const は通す", () => {
    expect(lintErrors(LINT_CASES.moduleLet)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.moduleConst)).toBe(0);
  });

  test("AC-022: Foldkit の file の sonner の import を error にする (web の import の禁止を失わない)", () => {
    expect(lintErrors(LINT_CASES.sonnerInFoldkit)).toBeGreaterThan(0);
    expect(lintErrors(LINT_CASES.startClean)).toBe(0);
  });
});

const FOLDKIT_SKILLS = ["foldkit", "generate-program", "audit-program"] as const;

describe("agent が読む Foldkit の参照と版", () => {
  test("AC-023: package.json の foldkit は範囲を持たない版で、repos/foldkit の subtree と 3 つの skill が同じ版を示す", () => {
    const packageJson: { devDependencies?: Record<string, string> } = JSON.parse(read("package.json"));
    const version = packageJson.devDependencies?.foldkit ?? "";
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const subtreePackageJson: { version?: string } = JSON.parse(
      read("repos/foldkit/packages/foldkit/package.json"),
    );
    expect(subtreePackageJson.version).toBe(version);
    for (const skill of FOLDKIT_SKILLS) {
      const skillVersions = [
        ...read(`.claude/skills/${skill}/SKILL.md`).matchAll(/\b\d+\.\d+\.\d+\b/g),
      ].map(([found]) => found);
      expect({ skill, versions: [...new Set(skillVersions)] }).toEqual({ skill, versions: [version] });
    }
  });

  test("AC-024: FOLDKIT.md・web/FOLDKIT.md・web/.mcp.json を置かず、.mcp.json に foldkit を書かない", () => {
    for (const file of ["FOLDKIT.md", "web/FOLDKIT.md", "web/.mcp.json"]) {
      expect({ file, exists: existsSync(join(REPO_ROOT, file)) }).toEqual({ file, exists: false });
    }
    expect(read(".mcp.json")).not.toMatch(/foldkit/i);
  });

  test("AC-025: web/src/CLAUDE.md が repos/foldkit を読む指示を持ち、.claude/skills に 3 つの skill がある", () => {
    expect(read("web/src/CLAUDE.md")).toContain("`repos/foldkit/` を読む");
    for (const skill of FOLDKIT_SKILLS) {
      const path = `.claude/skills/${skill}/SKILL.md`;
      expect({ path, exists: existsSync(join(REPO_ROOT, path)) }).toEqual({ path, exists: true });
      expect(read(path)).toMatch(new RegExp(`^---\\n(?:.*\\n)*?name: ${skill}\\n`));
    }
  });
});

describe("Story テストと Scene テスト", () => {
  test("AC-026: web/src の __tests__ に Story テストと Scene テストがあり、bun test で通る", () => {
    const stories = gitFiles(":(glob)web/src/**/__tests__/*.story.test.ts");
    const scenes = gitFiles(":(glob)web/src/**/__tests__/*.scene.test.ts");
    expect(stories.length).toBeGreaterThan(0);
    expect(scenes.length).toBeGreaterThan(0);
    const result = spawnSync("bun", ["test", ...[...stories, ...scenes].map((path) => `./${path}`)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect({ exitCode: result.status, output: result.stderr.slice(-2000) }).toMatchObject({
      exitCode: 0,
    });
  }, 60_000);
});

const TYPE_FIXTURE_HEADER = `import { Effect } from "effect";
import { Command, type Update } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Unauthorized } from "@core/failures";

const Message = defineMessageUnion({ Loaded: {}, ExpiredSession: {} });
type Message = typeof Message.Type;
type Model = { readonly count: number };
`;

const UNAUTHORIZED_LEFT = `${TYPE_FIXTURE_HEADER}
const Load = Command.define("Load", {
  messages: [Message.Loaded],
  execute: Effect.fail(new Unauthorized()).pipe(Effect.as(Message.Loaded())),
});

export const update = (model: Model): Update.Return<Model, Message> => ({ model, commands: [Load()] });
`;

const UNAUTHORIZED_AS_MESSAGE = `${TYPE_FIXTURE_HEADER}
const Load = Command.define("Load", {
  messages: [Message.Loaded, Message.ExpiredSession],
  execute: Effect.fail(new Unauthorized()).pipe(
    Effect.as(Message.Loaded()),
    Effect.catchTag("Unauthorized", () => Effect.succeed(Message.ExpiredSession())),
  ),
});

export const update = (model: Model): Update.Return<Model, Message> => ({ model, commands: [Load()] });
`;

const FAILURE_TABLE_HEADER = `import type { FailureMessages } from "${join(REPO_ROOT, "web/src/shared/failure-message.ts")}";

type Failure = { readonly _tag: "Conflict" } | { readonly _tag: "RateLimited" } | { readonly _tag: "Unauthorized" };
`;

const FAILURE_TABLE_MISSING_TAG = `${FAILURE_TABLE_HEADER}
export const messages: FailureMessages<Failure> = { Conflict: "競合" };
`;

const FAILURE_TABLE_COMPLETE = `${FAILURE_TABLE_HEADER}
export const messages: FailureMessages<Failure> = { Conflict: "競合", RateLimited: "回数の上限" };
`;

const typecheckWithWebConfig = (source: string) => {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-typecheck-"));
  try {
    symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
    writeFileSync(join(dir, "fixture.ts"), source);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: join(REPO_ROOT, "web/tsconfig.json"),
        compilerOptions: { noUnusedLocals: false, noUnusedParameters: false },
        include: [join(dir, "fixture.ts")],
      }),
    );
    const exe = spawnSync(join(REPO_ROOT, "node_modules/.bin/effect-tsgo"), ["get-exe-path"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).stdout.trim();
    const result = spawnSync(exe, ["--noEmit", "-p", join(dir, "tsconfig.json")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { exitCode: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("web の typecheck が失敗の扱いを型で止める", () => {
  test("AC-027: Unauthorized が残る Command を返す update は型エラーになり、Message にすれば通る", () => {
    const left = typecheckWithWebConfig(UNAUTHORIZED_LEFT);
    expect(left.exitCode).not.toBe(0);
    expect(left.output).toContain("Unauthorized");
    expect(left.output).not.toMatch(/Cannot find module|TS2307/);
    const handled = typecheckWithWebConfig(UNAUTHORIZED_AS_MESSAGE);
    expect({ exitCode: handled.exitCode, output: handled.output }).toEqual({
      exitCode: 0,
      output: "",
    });
  }, 120_000);

  test("AC-029: FailureMessages の表に _tag が欠けると型エラーになり、すべてを持つ表は通る", () => {
    const missing = typecheckWithWebConfig(FAILURE_TABLE_MISSING_TAG);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.output).toContain("RateLimited");
    const complete = typecheckWithWebConfig(FAILURE_TABLE_COMPLETE);
    expect({ exitCode: complete.exitCode, output: complete.output }).toEqual({
      exitCode: 0,
      output: "",
    });
  }, 120_000);
});

describe("文書と手動回帰の契機", () => {
  test("AC-033: docs/adr に Accepted の ADR-0023 があり、GLOSSARY の共通画面 SPA が画面の集まりである", () => {
    const adrs = readdirSync(join(REPO_ROOT, "docs/adr")).filter((file) => file.startsWith("0023-"));
    expect(adrs).toHaveLength(1);
    expect(read(`docs/adr/${adrs[0]}`)).toMatch(/Accepted/);
    const glossaryEntry = read("GLOSSARY.md").split("**共通画面 SPA**:\n")[1]?.split("\n")[0] ?? "";
    expect(glossaryEntry).toContain("画面の集まり");
  });

  test("AC-035: 手動回帰の契機の path の検査が通る", () => {
    const result = spawnSync("bun", ["test", "./src/__tests__/manual-regression-triggers.test.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect({ exitCode: result.status, output: result.stderr.slice(-2000) }).toMatchObject({
      exitCode: 0,
    });
  }, 60_000);
});
