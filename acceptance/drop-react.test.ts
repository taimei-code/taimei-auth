import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const run = (command: string, args: string[], cwd = REPO_ROOT, env = process.env) =>
  spawnSync(command, args, { cwd, encoding: "utf8", env });

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] =>
  run("git", ["grep", "-n", "-E", "--untracked", pattern, "--", ...pathspecs])
    .stdout.split("\n")
    .filter((line) => line !== "");

const gitFiles = (...pathspecs: string[]): string[] =>
  run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspecs])
    .stdout.split("\n")
    .filter((line) => line !== "" && existsSync(join(REPO_ROOT, line)));

type Diagnostic = { readonly filename: string; readonly severity: string; readonly code: string };

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

const LINT_CASES = {
  reactImport: {
    path: "web/src/shared/react-probe.ts",
    source: 'import { useState } from "react";\nexport const probe = useState;\n',
  },
  jsx: {
    path: "web/src/shared/jsx-probe.tsx",
    source: "export const probe = <div />;\n",
  },
  switchInTest: {
    path: "web/src/mfa/__tests__/switch-probe.test.ts",
    source:
      'type Message = { readonly _tag: "A" } | { readonly _tag: "B" };\nexport const probe = (message: Message) => {\n  switch (message._tag) {\n    case "A":\n      return 1;\n    case "B":\n      return 2;\n  }\n};\n',
  },
  switchInPage: {
    path: "web/src/mfa/switch-probe.ts",
    source:
      'type Message = { readonly _tag: "A" } | { readonly _tag: "B" };\nexport const probe = (message: Message) => {\n  switch (message._tag) {\n    case "A":\n      return 1;\n    case "B":\n      return 2;\n  }\n};\n',
  },
} as const;

type LintCaseName = keyof typeof LINT_CASES;

let fixtureDir = "";
const lintErrorsByPath = new Map<string, Diagnostic[]>();

const typecheckFails = (casePath: string): boolean => {
  const tsc = run(join(REPO_ROOT, "node_modules/.bin/effect-tsgo"), ["get-exe-path"]).stdout.trim();
  const config = join(fixtureDir, `tsconfig.${casePath.replace(/[/.]/g, "-")}.json`);
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(REPO_ROOT, "web/tsconfig.json"),
      include: [join(fixtureDir, casePath)],
    }),
  );
  return run(tsc, ["--noEmit", "-p", config], fixtureDir).status !== 0;
};

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "acceptance-396-"));
  writeFileSync(join(fixtureDir, ".oxlintrc.json"), repoConfigForFixture());
  symlinkSync(join(REPO_ROOT, "node_modules"), join(fixtureDir, "node_modules"));
  for (const { path, source } of Object.values(LINT_CASES)) {
    mkdirSync(dirname(join(fixtureDir, path)), { recursive: true });
    writeFileSync(join(fixtureDir, path), source);
  }
  const result = run(join(REPO_ROOT, "node_modules/.bin/oxlint"), ["--format", "json", "web"], fixtureDir);
  const report: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  for (const diagnostic of report.diagnostics) {
    if (diagnostic.severity === "error") {
      lintErrorsByPath.set(diagnostic.filename, [
        ...(lintErrorsByPath.get(diagnostic.filename) ?? []),
        diagnostic,
      ]);
    }
  }
});

afterAll(() => {
  if (fixtureDir !== "") {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

const lintErrors = (name: LintCaseName) => lintErrorsByPath.get(LINT_CASES[name].path) ?? [];

const lintOrTypecheckFails = (name: LintCaseName) =>
  lintErrors(name).length > 0 || typecheckFails(LINT_CASES[name].path);

const REACT_ERA_PACKAGES = String.raw`react|react-dom|@tanstack/react-router|@effect/atom-react|@radix-ui/[^"'/]+|lucide-react|sonner`;

describe("web は React を使わない", () => {
  test("AC-001: package.json に TanStack Router・@effect/atom-react・Radix・lucide-react・sonner の依存が無い", () => {
    expect(
      gitGrep(String.raw`"(@tanstack/react-router|@effect/atom-react|@radix-ui/[^"]+|lucide-react|sonner)"\s*:`, "package.json"),
    ).toEqual([]);
  });

  test("AC-002: web の source は React と React の時代の package を import しない", () => {
    expect(
      gitGrep(
        String.raw`(from\s+|import\s*\(\s*|import\s+)["'](${REACT_ERA_PACKAGES})(/[^"']*)?["']`,
        "web",
      ),
    ).toEqual([]);
  });

  test("AC-003: web/src に react を import する file を置くと、lint か typecheck が落ちる", () => {
    expect(lintOrTypecheckFails("reactImport")).toBe(true);
  });

  test("AC-004: web/src に JSX を書いた file を置くと、lint か typecheck が落ちる", () => {
    expect(lintOrTypecheckFails("jsx")).toBe(true);
  });
});

describe("React の時代の atom の土台と、その lint の例外が無い", () => {
  test("AC-005: web/src/shared/atom-runtime.ts が無い", () => {
    expect(gitFiles("web/src/shared/atom-runtime.ts")).toEqual([]);
  });

  test("AC-006: .oxlintrc.json は atom-runtime を名指さない", () => {
    expect(gitGrep("atom-runtime", ".oxlintrc.json")).toEqual([]);
  });
});

describe("Foldkit の lint は test の file にも効く", () => {
  test("AC-007: web/src の test の file で message の _tag を switch すると lint が落ちる", () => {
    expect(lintErrors("switchInTest").map((diagnostic) => diagnostic.code)).toContain(
      "foldkit(no-switch-on-message-tag)",
    );
  });

  test("AC-008: web/src の test でない file で message の _tag を switch すると、変わらず lint が落ちる", () => {
    expect(lintErrors("switchInPage").map((diagnostic) => diagnostic.code)).toContain(
      "foldkit(no-switch-on-message-tag)",
    );
  });
});

const BASELINE_WEB_JS_BYTES = 832_129;

const jsBytesUnder = (dir: string): number =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".js"))
    .reduce((total, path) => total + statSync(join(dir, path)).size, 0);

test(
  "AC-009: 本番の web を build した JS の合計は、移行前の 832,129 B を超えない",
  () => {
    const outDir = mkdtempSync(join(tmpdir(), "acceptance-396-web-dist-"));
    try {
      const build = run(join(REPO_ROOT, "node_modules/.bin/vite"), [
        "build",
        "--configLoader",
        "runner",
        "--config",
        "web/vite.config.ts",
        "--outDir",
        outDir,
        "--emptyOutDir",
        "--logLevel",
        "error",
      ], REPO_ROOT, shellEnv);
      expect(build.status).toBe(0);
      expect(jsBytesUnder(join(outDir, "assets"))).toBeLessThanOrEqual(BASELINE_WEB_JS_BYTES);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  },
  120_000,
);

describe("React と Atom の時代の規則の文と test が残らない", () => {
  test("AC-010: web/src と src/__tests__ に React と Atom の時代の仕組みの名前が無い", () => {
    expect(
      gitGrep(
        "reactivityKeys|previousSuccess|promiseExit|useAtomSet|SpaApiClient|AsyncSection|useEffect|atom-runtime|getRouteApi|validateSearch|beforeLoad|RegistryProvider",
        "web/src",
        "src/__tests__",
      ),
    ).toEqual([]);
  });

  test("AC-011: web/src/CLAUDE.md は Foldkit の skill と repos/foldkit/ を読む指示を持つ", () => {
    const claude = read("web/src/CLAUDE.md");
    expect(claude).toContain("foldkit");
    expect(claude).toContain("repos/foldkit/");
  });
});

const sectionOf = (markdown: string, heading: string): string => {
  const start = markdown.indexOf(`\n${heading}\n`);
  if (start === -1) return "";
  const rest = markdown.slice(start + heading.length + 2);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
};

test("AC-012: ADR-0023 の Consequences の節は、台帳の G1・G2・G3 と web の JS の合計に触れる", () => {
  const consequences = sectionOf(read("docs/adr/0023-web-foldkit.md"), "## Consequences");
  for (const topic of ["G1", "G2", "G3", "JS"]) {
    expect(consequences).toContain(topic);
  }
});
