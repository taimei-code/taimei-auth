import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { grepFiles, REPO_ROOT } from "../../__tests__/grep-files";

const HANDLERS_DIR = join(REPO_ROOT, "src/handlers");
const THREE_TARGET_FILES = [
  join(HANDLERS_DIR, "account-company.ts"),
  join(HANDLERS_DIR, "account-invitation.ts"),
  join(HANDLERS_DIR, "account-membership.ts"),
];

describe("Transport 層の禁止事項 (ADR-0012 の regression ガード)", () => {
  test("QA-H-10 / QA-E-10 handlers/ (テスト除外) に runInTransaction 出現なし", () => {
    expect(grepFiles("runInTransaction", HANDLERS_DIR, { excludeTests: true })).toEqual([]);
  });

  test("QA-M-01 3 handler ファイル (account-*.ts) に c.json({error 出現なし (envelope 統一)", () => {
    const offenders = THREE_TARGET_FILES.flatMap((file) =>
      grepFiles("c\\.json\\(\\{\\s*error", file),
    );
    expect(offenders).toEqual([]);
  });

  test("QA-H-11 3 handler ファイルで runRoute が最低 14 回出現 (14 route の adapter 統一の下限)", () => {
    const total = THREE_TARGET_FILES.reduce(
      (acc, f) => acc + grepFiles("runRoute\\(", f, { lines: true }).length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(14);
  });

  test("Stage 1 ゲート: handlers/ (テスト除外) に旧 guard API の呼び出しが無い", () => {
    const legacyApis = ["guardErrorResponse", "reasonToGuardError", "resolveParseBody"];
    const offenders = legacyApis.filter(
      (legacy) => grepFiles(legacy, HANDLERS_DIR, { excludeTests: true }).length > 0,
    );
    expect(offenders).toEqual([]);
  });
});
