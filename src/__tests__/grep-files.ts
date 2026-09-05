import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type GrepOptions = {
  /** 走査する glob (既定: *.ts)。 */
  readonly include?: readonly string[];
  /** __tests__ を除外する。 */
  readonly excludeTests?: boolean;
  /** path に /__tests__/ を含む file だけを返す (test 側の gate 用)。 */
  readonly onlyTests?: boolean;
  /** file 一覧 (-l) でなく hit 行を返す。出現「回数」を数える gate 用。 */
  readonly lines?: boolean;
};

// 静的 gate 用の grep。test 自身が pattern を含むと self-hit するため、in-process 走査ではなく
// 子 process の grep に投げる。shell を挟まない (execFileSync) のは、pattern 中の `$` / backtick / `\` が
// 展開されて別の pattern になり gate が黙って緩むのを防ぐため。返り値は REPO_ROOT 相対の file path 一覧
// (lines: true なら hit 行)。
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
    // grep は「一致なし」で exit 1、path 不在や引数不正で exit 2 以上。後者を 0 件と読むと検査が fail-open になる。
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}
