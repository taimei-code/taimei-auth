import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const STOPPING_CODE = /^(taimei\(|eslint\(no-restricted-)/;

type Diagnostic = { readonly code: string; readonly filename: string; readonly severity: string };

const configWithAbsolutePlugins = (): string => {
  const config: { jsPlugins?: Array<string | { name: string; specifier: string }> } = JSON.parse(
    readFileSync(join(REPO_ROOT, ".oxlintrc.json"), "utf8"),
  );
  const absolute = (specifier: string) =>
    specifier.startsWith(".") ? join(REPO_ROOT, specifier) : specifier;
  const jsPlugins = (config.jsPlugins ?? []).map((plugin) =>
    typeof plugin === "string" ? absolute(plugin) : { ...plugin, specifier: absolute(plugin.specifier) },
  );
  return JSON.stringify({ ...config, jsPlugins });
};

export const stoppingLintCodes = (path: string, source: string): string[] => {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-lint-probe-"));
  try {
    writeFileSync(join(dir, ".oxlintrc.json"), configWithAbsolutePlugins());
    symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), `${source}\n`);
    const result = spawnSync(
      join(REPO_ROOT, "node_modules/.bin/oxlint"),
      ["--disable-nested-config", "--format", "json", path],
      { cwd: dir, encoding: "utf8", timeout: 300_000 },
    );
    const { diagnostics }: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
    return diagnostics
      .filter(
        ({ filename, code, severity }) =>
          filename === path && severity === "error" && STOPPING_CODE.test(code),
      )
      .map(({ code }) => code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
