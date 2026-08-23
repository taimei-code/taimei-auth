import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  analyzeWebStructure,
  extractModuleSpecifiers,
  findMoveManifestMismatches,
  findRawManifestMismatches,
  findStaleReferences,
  findUnapprovedChangedPaths,
  HISTORICAL_STALE_ALLOWLIST,
  normalizeTypeScriptStructure,
  readActualWebSources,
  readRepoTextSources,
  readWorkingTreeChangedPaths,
} from "./web-domain-structure-helpers";
import {
  WEB_DOMAIN_BASELINE_HEAD,
  WEB_DOMAIN_MOVE_MANIFEST,
  WEB_DOMAIN_RAW_MANIFEST,
} from "./web-domain-move-manifest";

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

describe("normalizeTypeScriptStructure", () => {
  test("import path、import order、comment だけの差を同一化する", async () => {
    const before = `
      // old path
      import { b } from "./old-b";
      import { a } from "./old-a";
      export const value = a + b;
      export const View = () => <>{/* old/path.tsx */}</>;
    `;
    const after = `
      import { a } from "../new/a";
      // new path
      import { b } from "../new/b";
      export const value = a + b;
      export const View = () => <>{/* new/path.tsx */}</>;
    `;

    expect(await normalizeTypeScriptStructure(before, "before.ts")).toBe(
      await normalizeTypeScriptStructure(after, "after.ts"),
    );
  });

  test("logic token の変更は mismatch にする", async () => {
    const before = "export const value = left + right;";
    const after = "export const value = left - right;";

    expect(await normalizeTypeScriptStructure(before, "before.ts")).not.toBe(
      await normalizeTypeScriptStructure(after, "after.ts"),
    );
  });
});

describe("baseline move manifest", () => {
  test("move-only 50 file と raw 2 file が baseline digest に一致する", async () => {
    expect(WEB_DOMAIN_BASELINE_HEAD).toBe("91dde8ae421a18621a049f0a3692abf5f89861f4");
    expect(WEB_DOMAIN_MOVE_MANIFEST).toHaveLength(50);
    expect(WEB_DOMAIN_RAW_MANIFEST).toHaveLength(2);
    expect(await findMoveManifestMismatches(WEB_DOMAIN_MOVE_MANIFEST)).toEqual([]);
    expect(findRawManifestMismatches(WEB_DOMAIN_RAW_MANIFEST)).toEqual([]);
  });

  test("move-only source の logic mutation を path 付きで拒否する", async () => {
    const [entry] = WEB_DOMAIN_MOVE_MANIFEST;
    const findings = await findMoveManifestMismatches([entry], (path) => {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
      return `${source}\nexport const injectedMutation = true;\n`;
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toStartWith(`${entry.currentPath}: normalized digest mismatch`);
  });

  test("raw source の mutation を path 付きで拒否する", () => {
    const [entry] = WEB_DOMAIN_RAW_MANIFEST;
    const findings = findRawManifestMismatches([entry], (path) => {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
      return `${source}\n/* injected mutation */\n`;
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toStartWith(`${entry.currentPath}: raw digest mismatch`);
  });
});

describe("refactor completion checkers", () => {
  test("approved path だけを通し package change を拒否する", () => {
    expect(
      findUnapprovedChangedPaths([
        "web/src/app/App.tsx",
        "web/components.json",
        "src/company/org-code.ts",
        "docs/adr/0015-web-domain-first-directory-structure.md",
      ]),
    ).toEqual([]);
    expect(findUnapprovedChangedPaths(["package.json"])).toEqual(["package.json"]);
  });

  test("stale path を path と line 付きで報告し明示allowlistだけ除外する", () => {
    const sources = {
      "src/live.ts": 'import "@/lib/account-api";',
      "docs/history.md": "historical web/src/pages/SignIn.tsx",
      "packages/client/README.md": 'import { authClient } from "@/lib/auth/client";',
    };

    expect(findStaleReferences(sources, new Set(["docs/history.md"]))).toEqual([
      'src/live.ts:1: import "@/lib/account-api";',
    ]);
  });

  test("実 worktree の変更 path (untracked 含む) が全て approved である", () => {
    expect(findUnapprovedChangedPaths(readWorkingTreeChangedPaths())).toEqual([]);
  });

  test("実 repo の text に旧 path への live reference が無い", () => {
    expect(findStaleReferences(readRepoTextSources(), HISTORICAL_STALE_ALLOWLIST)).toEqual([]);
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
