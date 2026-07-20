import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ADR-0012 の Transport 禁止事項を静的に固定するリグレッションガード。
// (1) handlers/ (テスト除外) は runInTransaction を持たない = tx orchestration は Use-case 層のみ
// (2) 3 handler ファイル (account-{company,invitation,membership}.ts) の error return は
//     guardErrorResponse 経由に統一済 (raw c.json({error:...}) が 0 件)
// (3) 上記 3 ファイルは use-case Result → GuardErrorResult 写像に reasonToGuardError を使う
//     (少なくとも 6 出現 — 6 route の envelope 統一の下限を弱検査で pin)
// test 自身が該当 pattern を含むと self-hit するため grep は execSync でシェルに投げる。

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const HANDLERS_DIR = join(REPO_ROOT, "src/handlers");
const THREE_TARGET_FILES = [
  join(HANDLERS_DIR, "account-company.ts"),
  join(HANDLERS_DIR, "account-invitation.ts"),
  join(HANDLERS_DIR, "account-membership.ts"),
];

function grepCount(pattern: string, path: string, extra: string = ""): number {
  try {
    const out = execSync(`grep -rEc ${extra} ${JSON.stringify(pattern)} ${JSON.stringify(path)}`, {
      encoding: "utf8",
    });
    // grep -c は各 file の hit 数を "path:N" 形式で返す。単一 file なら数字のみ。
    // -r で複数 file 走査の場合は path:N 行を全 file 分足して総和にする。
    return out
      .trim()
      .split("\n")
      .reduce((acc, line) => {
        const n = Number(line.includes(":") ? line.split(":").pop() : line);
        return acc + (Number.isFinite(n) ? n : 0);
      }, 0);
  } catch (_) {
    // no match → grep exit 1 → treat as 0.
    return 0;
  }
}

describe("Transport 層の禁止事項 (ADR-0012 の regression ガード)", () => {
  test("QA-H-10 / QA-E-10 handlers/ (テスト除外) に runInTransaction 出現なし", () => {
    // handlers/ から runInTransaction を除去 = tx orchestration は Use-case 層のみが所有。
    const count = grepCount(
      "runInTransaction",
      HANDLERS_DIR,
      "--include=*.ts --exclude-dir=__tests__",
    );
    expect({ handlersDir: HANDLERS_DIR, runInTransactionCount: count }).toEqual({
      handlersDir: HANDLERS_DIR,
      runInTransactionCount: 0,
    });
  });

  test("QA-M-01 3 handler ファイル (account-*.ts) に c.json({error 出現なし (envelope 統一)", () => {
    // grep 対象は 3 file に限定 — スコープ外の avatar-upload.ts 等は独自の error return を持つ。
    for (const file of THREE_TARGET_FILES) {
      const count = grepCount("c\\.json\\(\\{\\s*error", file);
      expect({ file, cJsonErrorCount: count }).toEqual({ file, cJsonErrorCount: 0 });
    }
  });

  test("QA-H-11 3 handler ファイルで reasonToGuardError が最低 6 回出現 (6 route の envelope 統一の下限)", () => {
    // 6 route が use-case Result → GuardErrorResult 写像に reasonToGuardError を使う下限を弱検査。
    // AST 厳密検査はスコープ外 (実装者判断)。加算方式で 3 file 合計を数える。
    const total = THREE_TARGET_FILES.reduce(
      (acc, f) => acc + grepCount("reasonToGuardError", f),
      0,
    );
    expect(total).toBeGreaterThanOrEqual(6);
  });
});
