// GitHub Actions の action を 40 桁 commit SHA で pin し続けているかの config invariant。
// pin 規約の正本: docs/adr/0009-supply-chain-hardening.md §A

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO_ROOT,
  usesLines,
  workflowFileNames,
  workflowPinViolations,
} from "./config-invariant-helpers";

describe("GitHub Actions の action pin invariant", () => {
  test("QA-M-16: workflow の uses は全て 40 桁 SHA + version コメント", () => {
    const names = workflowFileNames();
    // 現行 3 本 (ci / deploy / publish-auth-client) を下回る = 読み取り path の取り違え。
    expect(names.length).toBeGreaterThanOrEqual(3);

    let total = 0;
    for (const name of names) {
      const text = readFileSync(join(REPO_ROOT, ".github/workflows", name), "utf8");
      total += usesLines(text).length;
      expect(workflowPinViolations(text, name)).toEqual([]);
    }
    // uses が 1 件も無い = selector 空振りの検出。
    expect(total).toBeGreaterThan(0);

    // tag 形式は違反として検出できる (assert が形式を実際に見ていることの positive control)。
    expect(workflowPinViolations("      - uses: actions/checkout@v4\n", "fixture").length).toBe(1);

    // 大文字 SHA / version コメント後ろの補足 / ローカル composite action は違反にしない
    // (どれも供給元は変わらないのに落ちると、pin 検査を止める方向の圧力になる)。
    expect(
      workflowPinViolations(
        "      - uses: actions/checkout@DE0FAC2E4500DABE0009E67214FF5F5447CE83DD # v6.0.2\n",
        "fixture",
      ),
    ).toEqual([]);
    expect(
      workflowPinViolations(
        "      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2 (pinned)\n",
        "fixture",
      ),
    ).toEqual([]);
    expect(workflowPinViolations("      - uses: ./.github/actions/setup\n", "fixture")).toEqual([]);
  });
});
