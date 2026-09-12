import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./grep-files";

// 2026-09-10 実測。増減した PR は必ずこの値を実測に合わせる。
const BUDGET = 258;
const DIRS = ["src", "db", "management", "web/src"];
const EXEMPT = [
  "src/request-context.ts",
  "web/src/shared/ui/native-select.tsx",
  "src/mfa/totp/cipher.ts",
];

function isProductionFile(file: string): boolean {
  return (
    /\.tsx?$/.test(file) &&
    !file.endsWith(".d.ts") &&
    !file.includes("/__tests__/") &&
    !file.includes(".test.") &&
    !file.includes("/gen/") &&
    !EXEMPT.some((prefix) => file.startsWith(prefix))
  );
}

function countBlocks(source: string): { blocks: number; lines: number } {
  let blocks = 0;
  let lines = 0;
  let inBlock = false;
  let prevIsComment = false;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    let isComment = false;
    if (inBlock) {
      isComment = true;
      if (line.includes("*/")) inBlock = false;
    } else if (line.startsWith("//")) {
      isComment = true;
    } else if (line.startsWith("/*") || line.startsWith("{/*")) {
      isComment = true;
      if (!line.includes("*/")) inBlock = true;
    }
    if (isComment) lines++;
    if (isComment && !prevIsComment) blocks++;
    prevIsComment = isComment;
  }
  return { blocks, lines };
}

function countCommentBlocks(): [string, { blocks: number; lines: number }][] {
  return execFileSync("git", ["ls-files", "-co", "--exclude-standard", ...DIRS], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(isProductionFile)
    .filter((file) => existsSync(join(REPO_ROOT, file)))
    .map((file) => [file, countBlocks(readFileSync(join(REPO_ROOT, file), "utf8"))]);
}

describe("コメント予算 (design 2026-09-09 Phase 0)", () => {
  test("production のコメントブロック数は BUDGET と一致する", () => {
    const perFile = countCommentBlocks();
    const total = perFile.reduce((sum, [, n]) => sum + n.blocks, 0);
    const top = perFile
      .sort((a, b) => b[1].blocks - a[1].blocks)
      .slice(0, 8)
      .map(([file, n]) => `${n.blocks}\t${file}`)
      .join("\n");
    expect(total, `blocks=${total} BUDGET=${BUDGET}\n${top}`).toBe(BUDGET);
  });

  test("コメントブロックは 1 行に収める (src/CLAUDE.md)", () => {
    const multi = countCommentBlocks()
      .filter(([, n]) => n.lines !== n.blocks)
      .map(([file, n]) => `${n.lines - n.blocks}\t${file}`)
      .join("\n");
    expect(multi, `2 行以上のブロックを持つ file:\n${multi}`).toBe("");
  });
});
