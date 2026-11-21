import { describe, expect, test } from "bun:test";

import { readWorkflow } from "./config-invariant-helpers";

const SHELLCHECK_OF_LISTED_DIRECTORIES = /shellcheck .*scripts\/\*\.sh/;

describe("ci.yml の shellcheck", () => {
  test("対象の shell script を dir の列挙で書かない。新しい dir の script が検査から漏れる", () => {
    const runs = Object.values(
      readWorkflow<{ jobs: Record<string, { steps?: { run?: string }[] }> }>("ci.yml").jobs,
    )
      .flatMap((job) => job.steps ?? [])
      .flatMap((step) => (step.run === undefined ? [] : [step.run]));

    expect(runs.filter((run) => SHELLCHECK_OF_LISTED_DIRECTORIES.test(run))).toEqual([]);
  });
});
