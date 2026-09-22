import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type GrepOptions = {
  readonly include?: readonly string[];
  readonly excludeTests?: boolean;
  readonly onlyTests?: boolean;
  readonly lines?: boolean;
};

// in-process で走査しない (テスト自身が pattern を含み自分に一致する)。shell を挟まない (`$` や backtick が展開されて gate が緩む)。
export function grepFiles(pattern: string, target: string, opts: GrepOptions = {}): string[] {
  const flags = [
    opts.lines ? "-rE" : "-rEl",
    ...(opts.include ?? ["*.ts"]).map((glob) => `--include=${glob}`),
    ...(opts.excludeTests ? ["--exclude-dir=__tests__"] : []),
  ];
  const path = isAbsolute(target) ? target : join(REPO_ROOT, target);
  try {
    const out = execFileSync("grep", [...flags, pattern, path], { encoding: "utf8" });
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace(`${REPO_ROOT}/`, ""))
      .filter((line) => !opts.onlyTests || line.includes("/__tests__/"));
  } catch (error) {
    // grep は一致なしで exit 1、パス不在や引数不正で exit 2 以上 (0 件と読むと fail-open)。
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}
