import { describe, expect, test } from "bun:test";

import {
  analyzeWebStructure,
  extractModuleSpecifiers,
  readActualWebSources,
} from "./web-domain-structure-helpers";

describe("extractModuleSpecifiers", () => {
  test("全 static import 形式と literal dynamic import を抽出する", async () => {
    const source = `
      import "./side-effect";
      import type { A } from "./types";
      import {
        value,
      } from "./multiline";
      export { other } from "./re-export";
      export type { B } from "./type-re-export";
      const lazy = import("./dynamic");
      const ignored = import(variable);
    `;

    expect(await extractModuleSpecifiers(source, "fixture.ts")).toEqual([
      "./side-effect",
      "./types",
      "./multiline",
      "./re-export",
      "./type-re-export",
      "./dynamic",
    ]);
  });
});

describe("analyzeWebStructure fixtures", () => {
  test("@core specifier を shadow する web file を拒否する", async () => {
    const result = await analyzeWebStructure({
      "web/src/company/OrgCodeField.tsx":
        'import { orgCodeLabelJa } from "@core/company/org-code";',
      "web/src/company/org-code.ts": 'export const orgCodeLabelJa = () => "";',
    });

    expect(result.violations).toContain(
      "@core specifier shadowed by web file: company/OrgCodeField.tsx -> company/org-code.ts",
    );
  });

  test.each([
    ["web/src/pages/Legacy.tsx", "legacy root pages directory: pages/Legacy.tsx"],
    ["web/src/auth/lib/helper.ts", "forbidden technical directory: auth/lib/helper.ts"],
    ["web/src/mfa/components/View.tsx", "forbidden technical directory: mfa/components/View.tsx"],
  ])("%s を拒否する", async (path, violation) => {
    expect((await analyzeWebStructure({ [path]: "export {};" })).violations).toContain(violation);
  });
});

describe("actual web/src structure", () => {
  test("target roots を持ち違反がない", async () => {
    const result = await analyzeWebStructure(readActualWebSources(), { enforceTargetTree: true });

    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.roots).toEqual([
      "account",
      "app",
      "auth",
      "company",
      "invitation",
      "membership",
      "mfa",
      "shared",
    ]);
    expect(result.violations).toEqual([]);
  });
});
