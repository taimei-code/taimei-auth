import { describe, expect, test } from "bun:test";
import { grepFiles } from "../../__tests__/source-scan";

describe("Guard 層は hono を直接 import しない", () => {
  test("guard/*.ts / policy.ts / accept.ts は型も値も hono を import しない (層の依存は型の import も数える)", () => {
    const targets = [
      "src/membership/guard",
      "src/membership/policy.ts",
      "src/invitation/accept.ts",
    ];
    expect(
      targets.flatMap((target) =>
        grepFiles(String.raw`from\s+["']hono["']`, target, { tests: "exclude" }),
      ),
    ).toEqual([]);
  });
});
