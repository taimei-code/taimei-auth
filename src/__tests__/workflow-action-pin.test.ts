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
    expect(names.length).toBeGreaterThanOrEqual(3);

    let total = 0;
    for (const name of names) {
      const text = readFileSync(join(REPO_ROOT, ".github/workflows", name), "utf8");
      total += usesLines(text).length;
      expect(workflowPinViolations(text, name)).toEqual([]);
    }
    expect(total).toBeGreaterThan(0);

    expect(workflowPinViolations("      - uses: actions/checkout@v4\n", "fixture").length).toBe(1);

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
