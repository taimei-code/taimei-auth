import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { REPO_ROOT, filesImporting, grepFiles, valueImportsOf } from "../../__tests__/source-scan";

const TESTING_MODULE = /(^|\/)(testing\/|testing-routes|testing-server)/;

const resolveLocal = (from: string, specifier: string): string | undefined => {
  const base = specifier.startsWith("@/")
    ? specifier.slice(2)
    : specifier.startsWith("@core/")
      ? `src/${specifier.slice(6)}`
      : specifier.startsWith(".")
        ? normalize(join(dirname(from), specifier))
        : undefined;
  if (base === undefined) return undefined;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(
    (candidate) => candidate.match(/\.tsx?$/) && existsSync(join(REPO_ROOT, candidate)),
  );
};

const reachableFrom = (entry: string): Set<string> => {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of valueImportsOf(file)) {
      const resolved = resolveLocal(file, specifier);
      if (resolved) pending.push(resolved);
    }
  }
  return seen;
};

describe("試験 API を本番の entry から辿れない", () => {
  test("本番の worker (src/worker.ts) と通常の Bun の entry (src/index.ts) の import を辿っても、試験の module に届かない", () => {
    for (const entry of ["src/worker.ts", "src/index.ts"]) {
      const reached = [...reachableFrom(entry)];
      expect(reached).toContain("src/app.ts");
      expect(reached.filter((file) => TESTING_MODULE.test(file))).toEqual([]);
    }
  });

  test("試験の module を import するのは、試験用の entry と試験の module 自身だけ", () => {
    const importers = filesImporting(TESTING_MODULE, "src", { tests: "exclude" }).filter(
      (file) => !TESTING_MODULE.test(file),
    );
    expect(importers).toEqual([]);
  });

  test("資格情報なしに user を作る AuthApi.createUser を呼ぶのは、試験の利用者を作る use-case だけ", () => {
    expect(
      grepFiles("(^|[^A-Za-z0-9_$])createUser\\(", "src", { tests: "exclude" }).sort(),
    ).toEqual([
      "src/auth-service.ts",
      "src/auth-wiring.ts",
      "src/testing/create-signed-in-user.ts",
    ]);
  });
});
