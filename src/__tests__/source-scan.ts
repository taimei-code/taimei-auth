import { execFileSync } from "node:child_process";
import { Predicate } from "effect";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const SOURCE_ROOTS = [
  "src",
  "db",
  "web/src",
  "e2e",
  "management",
  "packages",
  "testing",
] as const;

type TestFiles = "include" | "exclude" | "only";

type ScanOptions = {
  readonly include?: readonly string[];
  readonly tests?: TestFiles;
};

const TS_SOURCES = ["*.ts", "*.tsx"];

const GREP_FOUND_NOTHING = 1;

const absolute = (path: string): string => (isAbsolute(path) ? path : join(REPO_ROOT, path));

const fromRepoRoot = (path: string): string =>
  path.startsWith(`${REPO_ROOT}/`) ? path.slice(REPO_ROOT.length + 1) : path;

const isTestPath = (path: string): boolean => `/${path}`.includes("/__tests__/");

const keepsPath = (tests: TestFiles, path: string): boolean => {
  if (tests === "include") return true;
  return tests === "only" ? isTestPath(path) : !isTestPath(path);
};

const grep =
  (output: "files" | "lines") =>
  (
    pattern: string,
    target: string,
    { include = TS_SOURCES, tests = "include" }: ScanOptions = {},
  ) => {
    const flags = [
      output === "files" ? "-rEl" : "-rE",
      ...include.map((glob) => `--include=${glob}`),
      ...(tests === "exclude" ? ["--exclude-dir=__tests__"] : []),
    ];
    try {
      return execFileSync("grep", [...flags, pattern, absolute(target)], { encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(fromRepoRoot)
        .filter((hit) => keepsPath(tests, hit));
    } catch (error) {
      if (Predicate.hasProperty(error, "status") && error.status === GREP_FOUND_NOTHING) return [];
      throw error;
    }
  };

export const grepFiles = grep("files");

export const grepLines = grep("lines");

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

export const valueImportsInSource = (file: string, source: string): string[] =>
  transpilers[file.endsWith(".tsx") ? "tsx" : "ts"].scanImports(source).map((entry) => entry.path);

export const valueImportsOf = (file: string): string[] =>
  valueImportsInSource(file, readFileSync(absolute(file), "utf8"));

export const repoFiles = (...pathspecs: string[]): string[] =>
  execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspecs],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter(Boolean);

type FileFilter = Pick<ScanOptions, "tests">;

export const sourceFiles = (target: string, { tests = "include" }: FileFilter = {}): string[] =>
  [...new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: absolute(target) })]
    .filter((path) => keepsPath(tests, path))
    .map((path) => fromRepoRoot(join(absolute(target), path)))
    .sort();

export const filesImporting = (
  specifier: RegExp,
  target: string,
  opts: FileFilter = {},
): string[] =>
  sourceFiles(target, opts).filter((file) =>
    valueImportsOf(file).some((imported) => specifier.test(imported)),
  );
