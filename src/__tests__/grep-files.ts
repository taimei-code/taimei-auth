import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type GrepOptions = {
  /** 走査する glob (既定は *.ts)。 */
  readonly include?: readonly string[];
  /** __tests__ を除外する。 */
  readonly excludeTests?: boolean;
  /** パスに /__tests__/ を含むファイルだけを返す (テスト側の gate 用)。 */
  readonly onlyTests?: boolean;
  /** ファイル一覧 (-l) ではなく hit した行を返す。出現回数を数える gate 用。 */
  readonly lines?: boolean;
};

// 静的 gate 用の grep。テスト自身が pattern を含むと自分自身に一致してしまうため、in-process で走査せず
// 子 process の grep に任せる。shell を挟まない (execFileSync) のは、pattern 中の `$` や backtick や `\` が
// 展開されて別の pattern になり、gate が気付かれないまま緩むのを防ぐため。返り値は REPO_ROOT からの相対ファイルパス一覧
// (lines: true なら hit した行)。
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
    // grep は一致なしで exit 1、パス不在や引数不正で exit 2 以上を返す。後者を 0 件と読むと検査が fail-open になる。
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}
