import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dir, "../..");

const declarationsIn = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(join(PACKAGE_ROOT, dir))
      .filter((name) => name.endsWith(".d.ts"))
      .toSorted()
      .map((name) => [name, readFileSync(join(PACKAGE_ROOT, dir, name), "utf8")]),
  );

describe("SDK の公開 interface の差分は、commit した api/ の写しに出る", () => {
  test("build した .d.ts は api/ の写しと同じ (違えば `bun run --cwd packages/auth-client api` で写しを更新し、差分を ADR-0028 の 5 層で読む)", () => {
    expect(declarationsIn("dist")).toEqual(declarationsIn("api"));
  });

  test("公開の型は never を返す関数を持たない (consumer の framework が throw で遷移する前提を持ち込まない)", () => {
    expect(
      Object.entries(declarationsIn("api"))
        .filter(([, declarations]) => /(=>|\)\s*:)\s*never\b/.test(declarations))
        .map(([name]) => name),
    ).toEqual([]);
  });
});
