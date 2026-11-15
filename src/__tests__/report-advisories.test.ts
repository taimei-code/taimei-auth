import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, workflowFileNames } from "./config-invariant-helpers";

const workflowsWithAuditIgnore = (names: readonly string[], read: (name: string) => string) =>
  names.filter((name) => /bun audit\b/.test(read(name)) && /--ignore\b/.test(read(name)));

describe("bun audit の --ignore の置き場所 (ADR-0009 §B)", () => {
  const readWorkflowText = (name: string) =>
    readFileSync(join(REPO_ROOT, ".github/workflows", name), "utf8");

  test("workflow は bun audit の --ignore を直に書かない。package.json の audit だけが持ち、CI の gate と毎日の report が同じ一覧を読む", () => {
    expect(workflowsWithAuditIgnore(workflowFileNames(), readWorkflowText)).toEqual([]);
  });

  test("workflow に --ignore 付きの bun audit を直に書くと、報告される", () => {
    const texts: Record<string, string> = {
      "ci.yml": "run: bun audit --audit-level=high --ignore=GHSA-vfj7-8cjw-p6xm",
    };
    expect(workflowsWithAuditIgnore(["ci.yml"], (name) => texts[name] ?? "")).toEqual(["ci.yml"]);
  });
});
