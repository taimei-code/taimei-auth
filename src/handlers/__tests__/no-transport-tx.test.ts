import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { grepFiles, REPO_ROOT } from "../../__tests__/grep-files";

// ADR-0012 の Transport 禁止事項と ADR-0017 の Stage 完了ゲートを静的に固定するリグレッションガード
// (design §4 I5 に従い、Stage ごとの禁止事項をこのファイルに積み上げる)。
// (1) handlers/ (テストを除く) は runInTransaction を持たない。つまり tx の orchestration は Use-case 層だけが行う
// (2) 3 つの handler ファイル (account-{company,invitation,membership}.ts) の error return は
//     runRoute (adapter) 経由に統一済みである (raw の c.json({error:...}) が 0 件)
// (3) Stage 1 ゲートとして、上記 3 ファイルは route を runRoute で走らせ (14 route 以上)、旧 API
//     (guardErrorResponse / reasonToGuardError / resolveParseBody) を handlers/ から呼ばない

const HANDLERS_DIR = join(REPO_ROOT, "src/handlers");
const THREE_TARGET_FILES = [
  join(HANDLERS_DIR, "account-company.ts"),
  join(HANDLERS_DIR, "account-invitation.ts"),
  join(HANDLERS_DIR, "account-membership.ts"),
];

describe("Transport 層の禁止事項 (ADR-0012 の regression ガード)", () => {
  test("QA-H-10 / QA-E-10 handlers/ (テスト除外) に runInTransaction 出現なし", () => {
    // handlers/ から runInTransaction を除去した。tx の orchestration は Use-case 層だけが持つ。
    expect(grepFiles("runInTransaction", HANDLERS_DIR, { excludeTests: true })).toEqual([]);
  });

  test("QA-M-01 3 handler ファイル (account-*.ts) に c.json({error 出現なし (envelope 統一)", () => {
    // grep の対象は 3 ファイルに限定する。スコープ外の avatar-upload.ts 等は独自の error return を持つ。
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
