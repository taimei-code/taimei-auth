import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { effectTsgo } from "./config-invariant-helpers";
import { REPO_ROOT, repoFiles } from "./source-scan";
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
      "passkey",
      "shared",
    ]);
    expect(result.violations).toEqual([]);
  });
});

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const foldkitPages = () =>
  repoFiles(":(glob)web/src/*/pages/*.ts", ":(glob)web/non-production/*.ts").filter((path) => {
    const source = read(path);
    return /from\s+["']foldkit(\/[^"']*)?["']/.test(source) && /export const update\b/.test(source);
  });

const testsOf = (page: string) => {
  const name = basename(page, ".ts");
  const pageDirectory = dirname(page);
  const testsDirectory = pageDirectory.endsWith("/pages")
    ? join(dirname(pageDirectory), "__tests__")
    : join(pageDirectory, "__tests__");
  return {
    story: join(testsDirectory, `${name}.story.test.ts`),
    scene: join(testsDirectory, `${name}.scene.test.ts`),
  };
};

const testNamesIn = (path: string): string[] =>
  [...read(path).matchAll(/\btest(?:\.each\([\s\S]*?\))?\(\s*["'`]([^"'`]+)["'`]/g)].map(
    ([, name]) => name ?? "",
  );

const PAGES_WITH_THEIR_OWN_RACE_TESTS = [
  "web/src/account/pages/Security.ts",
  "web/src/company/pages/Companies.ts",
  "web/src/company/pages/CompanySettings.ts",
  "web/src/membership/pages/Members.ts",
];

const DOMAINS_SHARING_RACE_TESTS = [["account", "invitation"], ["company"], ["auth"], ["mfa"]];

const namesOfStoryTests = (pages: readonly string[]) =>
  pages.map((page) => testsOf(page).story).flatMap(testNamesIn);

describe("Foldkit の page", () => {
  test("page ごとに、同じ domain の __tests__ に Story テストと Scene テストがある", () => {
    const pages = foldkitPages();
    expect(pages.length).toBeGreaterThanOrEqual(12);
    const tests = pages.flatMap((page) => Object.values(testsOf(page)));
    expect(repoFiles(...tests).sort()).toEqual([...tests].sort());
  });

  test("page は Model・Message・init・update・view を直接 export する", () => {
    const missing = foldkitPages().flatMap((page) =>
      ["Model", "Message", "init", "update", "view"]
        .filter((name) => !new RegExp(String.raw`export const ${name}\b`).test(read(page)))
        .map((name) => `${page}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  test.each(
    PAGES_WITH_THEIR_OWN_RACE_TESTS,
  )("%s の Story テストは、二重の操作と古い応答の test を持つ", (page) => {
    const names = namesOfStoryTests([page]);
    expect(names.some((name) => name.includes("二重"))).toBe(true);
    expect(names.some((name) => name.includes("古い"))).toBe(true);
  });

  test.each(
    DOMAINS_SHARING_RACE_TESTS,
  )("%j の page の Story テストは、二重の操作と古い応答の test を持つ", (...domains) => {
    const pages = foldkitPages().filter((page) =>
      domains.some((domain) => page.startsWith(`web/src/${domain}/pages/`)),
    );
    expect(pages.length).toBeGreaterThan(0);
    const names = namesOfStoryTests(pages);
    expect(names.some((name) => name.includes("二重"))).toBe(true);
    expect(names.some((name) => name.includes("古い"))).toBe(true);
  });

  test("shared/ui の部品は、@foldkit/ui を import して button・input・label の要素を描く", () => {
    const drawn = repoFiles(":(glob)web/src/shared/ui/*.ts")
      .map(read)
      .filter((source) => /from\s+["']@foldkit\/ui["']/.test(source))
      .join("\n");
    expect(drawn).toMatch(/\bh\.button\(/);
    expect(drawn).toMatch(/\bh\.input\(/);
    expect(drawn).toMatch(/\bh\.label\(/);
  });
});

const probeDirectories: string[] = [];

afterAll(() => {
  for (const directory of probeDirectories) rmSync(directory, { recursive: true, force: true });
});

const typecheckInDomainProject = (project: string, importedFile: string) => {
  const directory = mkdtempSync(join(tmpdir(), "web-domain-boundary-"));
  probeDirectories.push(directory);
  symlinkSync(join(REPO_ROOT, "node_modules"), join(directory, "node_modules"));
  mkdirSync(join(directory, "out"));
  const fixture = join(directory, "fixture.ts");
  writeFileSync(
    fixture,
    `import * as imported from "${join(REPO_ROOT, importedFile)}";\nexport { imported };\n`,
  );
  const projectFile = join(REPO_ROOT, "web/domain-projects", `${project}.json`);
  const { references }: { references: ReadonlyArray<{ path: string }> } = JSON.parse(
    readFileSync(projectFile, "utf8"),
  );
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      extends: projectFile,
      compilerOptions: {
        rootDir: "/",
        outDir: join(directory, "out"),
        tsBuildInfoFile: join(directory, "out/fixture.tsbuildinfo"),
      },
      include: [fixture],
      references: references.map(({ path }) => ({
        path: join(REPO_ROOT, "web/domain-projects", path),
      })),
    }),
  );
  const result = spawnSync(effectTsgo(), ["-b", join(directory, "tsconfig.json")], {
    encoding: "utf8",
  });
  return { exitCode: result.status, output: `${result.stdout}${result.stderr}` };
};

describe("web の domain の境界は、project references の型で守る (ADR-0025)", () => {
  test("参照している domain の file は import できる", () => {
    expect(typecheckInDomainProject("invitation", "web/src/shared/failure-message")).toEqual({
      exitCode: 0,
      output: "",
    });
  });

  test.each([
    {
      name: "invitation から mfa の file を import すると、TS6307 で落ちる",
      project: "invitation",
      importedFile: "web/src/mfa/mfa-code",
    },
    {
      name: "company の直下から account の page を import すると、TS6307 で落ちる",
      project: "company",
      importedFile: "web/src/account/pages/Profile",
    },
    {
      name: "shared から auth の file を import すると、TS6307 で落ちる",
      project: "shared",
      importedFile: "web/src/auth/sign-in-client",
    },
    {
      name: "auth から account の file を import して domain が循環すると、TS6307 で落ちる",
      project: "auth",
      importedFile: "web/src/account/current-company",
    },
  ])("$name", ({ project, importedFile }) => {
    const result = typecheckInDomainProject(project, importedFile);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("TS6307");
  });
});
