import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { valueImportsOf } from "./source-scan";

describe("valueImportsOf は実行時に読み込まれる import だけを返す", () => {
  test("型だけの import を除き、再 export と動的 import と副作用の import を含む", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-imports-"));
    try {
      const file = join(dir, "sample.ts");
      const dynamicImport = ["imp", "ort("].join("");
      writeFileSync(
        file,
        [
          'import type { A } from "./type-only";',
          'import { type B } from "./inline-type-only";',
          'import { c } from "./value";',
          'export { d } from "./re-export";',
          'export type { E } from "./type-re-export";',
          `const f = await ${dynamicImport}"./dynamic");`,
          'import "./side-effect";',
          "",
        ].join("\n"),
      );
      expect(valueImportsOf(file).sort()).toEqual([
        "./dynamic",
        "./re-export",
        "./side-effect",
        "./value",
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
