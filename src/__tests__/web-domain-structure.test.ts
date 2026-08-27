import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  analyzeWebStructure,
  extractModuleSpecifiers,
  readActualWebSources,
} from "./web-domain-structure-helpers";

// web/src のドメイン構造 (ADR-0015 / web/src/CLAUDE.md) を固定する恒久 architecture test。
// #151 の一度きり移行完了 witness は baseline merge 済みのため退役した (helper のコメント参照)。

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

describe("web tooling aliases", () => {
  test("shadcn generator が廃止済み technical directory を再生成しない", () => {
    const config = JSON.parse(
      readFileSync(new URL("../../web/components.json", import.meta.url), "utf8"),
    );

    expect(config.aliases).toEqual({
      components: "@/shared",
      utils: "@/shared/utils",
      ui: "@/shared/ui",
      lib: "@/shared",
      hooks: "@/shared",
    });
  });
});

describe("analyzeWebStructure fixtures", () => {
  test("allowlist 済みの domain import を受理する", async () => {
    const result = await analyzeWebStructure({
      "web/src/account/pages/Security.tsx":
        'import { MfaSettingsItem } from "../../mfa/MfaSettingsItem";',
      "web/src/mfa/MfaSettingsItem.tsx": "export const MfaSettingsItem = () => null;",
    });

    expect(result.violations).toEqual([]);
    expect(result.edges).toContain("account->mfa");
  });

  test("allowlist 外の domain import を拒否する", async () => {
    const result = await analyzeWebStructure({
      "web/src/account/pages/Profile.tsx":
        'import { reduceMfaChallengeFlow } from "../../mfa/mfa-challenge-flow";',
      "web/src/mfa/mfa-challenge-flow.ts": "export const reduceMfaChallengeFlow = () => {};",
    });

    expect(result.violations).toContain(
      "cross-domain path not allowed: account/pages/Profile.tsx -> mfa/mfa-challenge-flow.ts",
    );
  });

  test("他 domain の page import を拒否する", async () => {
    const result = await analyzeWebStructure({
      "web/src/account/ProfileLink.tsx": 'import { Companies } from "../company/pages/Companies";',
      "web/src/company/pages/Companies.tsx": "export const Companies = () => null;",
    });

    expect(result.violations).toContain(
      "domain page import is app-only: account/ProfileLink.tsx -> company/pages/Companies.tsx",
    );
  });

  test("shared から domain への逆依存を拒否する", async () => {
    const result = await analyzeWebStructure({
      "web/src/shared/notify.ts": 'import { authClient } from "../auth/auth-client";',
      "web/src/auth/auth-client.ts": "export const authClient = {};",
    });

    expect(result.violations).toContain(
      "shared reverse dependency: shared/notify.ts -> auth/auth-client.ts",
    );
  });

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

  test("domain graph の cycle を閉路として報告する", async () => {
    const result = await analyzeWebStructure({
      "web/src/account/current-company.tsx":
        'import { companyValue } from "../company/company-api";',
      "web/src/company/company-api.ts":
        'import { memberValue } from "../membership/membership-api"; export const companyValue = memberValue;',
      "web/src/membership/membership-api.ts":
        'import { accountValue } from "../account/current-company"; export const memberValue = accountValue;',
    });

    expect(result.violations).toContain(
      "domain dependency cycle: account -> company -> membership -> account",
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
  test("target roots と既知 edge を持ち違反がない", async () => {
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
    expect(result.edges).toContain("account->mfa");
    expect(result.violations).toEqual([]);
  });
});
