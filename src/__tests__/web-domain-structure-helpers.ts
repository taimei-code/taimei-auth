import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, posix, relative } from "node:path";
import { tmpdir } from "node:os";
import { API } from "typescript/unstable/async";
import { SyntaxKind, type Node, type SourceFile } from "typescript/unstable/ast";
import {
  isCallExpression,
  isExportDeclaration,
  isImportDeclaration,
  isStringLiteral,
} from "typescript/unstable/ast/is";

import { REPO_ROOT } from "./config-invariant-helpers";

// web/src のドメイン構造 (ADR-0015 / web/src/CLAUDE.md) を固定する恒久 architecture test の helper:
// analyzeWebStructure (cross-domain allowlist / pages 規則 / shared 逆依存 / cycle)。新しい
// cross-domain interface を設ける時は ALLOWED_CROSS_DOMAIN に file path を足し、設計変更として
// review する。#151 の一度きり移行完了 witness (move manifest 照合 / 変更 path 承認 / stale
// reference 検査) は baseline merge 済みのため退役した。

const WEB_SRC = join(REPO_ROOT, "web/src");

const DOMAIN_ROOTS = new Set(["account", "auth", "company", "invitation", "membership", "mfa"]);
const MODULE_ROOTS = new Set([...DOMAIN_ROOTS, "app", "shared"]);
const BOOTSTRAP_FILES = new Set(["index.css", "main.tsx", "vite-env.d.ts"]);

const ALLOWED_CROSS_DOMAIN = new Map<string, ReadonlySet<string>>([
  ["auth", new Set()],
  ["invitation", new Set(["auth/auth-client.ts", "auth/auth-redirect.ts"])],
  ["mfa", new Set(["auth/auth-redirect.ts"])],
  [
    "account",
    new Set([
      "auth/auth-client.ts",
      "auth/auth-redirect.ts",
      "auth/provider-label.ts",
      "mfa/mfa-api.ts",
      "mfa/MfaSettingsItem.tsx",
    ]),
  ],
  [
    "membership",
    new Set([
      "account/current-company.tsx",
      "auth/auth-client.ts",
      "invitation/invitation-api.ts",
      "invitation/PendingInvitations.tsx",
    ]),
  ],
  [
    "company",
    new Set([
      "account/current-company.tsx",
      "auth/auth-client.ts",
      "auth/auth-redirect.ts",
      "membership/membership-api.ts",
      "membership/TransferOwnershipModal.tsx",
    ]),
  ],
  [
    "app",
    new Set([
      "account/current-company.tsx",
      "account/pages/Connections.tsx",
      "account/pages/Profile.tsx",
      "account/pages/Security.tsx",
      "account/pages/Sessions.tsx",
      "auth/AuthLayout.tsx",
      "auth/SignOutButton.tsx",
      "auth/auth-redirect.ts",
      "auth/pages/Error.tsx",
      "auth/pages/SignIn.tsx",
      "auth/pages/SignUp.tsx",
      "company/CompanySwitcher.tsx",
      "company/pages/Companies.tsx",
      "company/pages/CompanySettings.tsx",
      "company/pages/SignUpCompany.tsx",
      "invitation/pages/SignUpAcceptInvitation.tsx",
      "membership/pages/Members.tsx",
      "mfa/pages/MfaChallenge.tsx",
    ]),
  ],
]);

type AnalyzeOptions = {
  enforceTargetTree?: boolean;
};

export type StructureResult = {
  violations: string[];
  edges: string[];
  roots: string[];
  fileCount: number;
};

// import 宣言 / re-export / literal dynamic import の module specifier。
const moduleSpecifierOf = (node: Node) => {
  if (
    (isImportDeclaration(node) || isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier;
  }
  if (
    isCallExpression(node) &&
    node.expression.kind === SyntaxKind.ImportKeyword &&
    node.arguments.length === 1 &&
    isStringLiteral(node.arguments[0])
  ) {
    return node.arguments[0];
  }
  return null;
};

const collectSpecifiers = (sourceFile: SourceFile): string[] => {
  const specifiers: string[] = [];
  const visit = (node: Node): void => {
    const specifier = moduleSpecifierOf(node);
    if (specifier) specifiers.push(specifier.text);
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return specifiers;
};

const withFixtureProject = async <T>(
  sources: ReadonlyMap<string, string>,
  run: (getSourceFile: (path: string) => Promise<SourceFile>) => Promise<T>,
): Promise<T> => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "taimei-web-domain-"));
  const api = new API({ cwd: fixtureRoot });
  try {
    for (const [path, source] of sources) {
      if (!path.endsWith(".ts") && !path.endsWith(".tsx")) continue;
      const full = join(fixtureRoot, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, source);
    }
    const configPath = join(fixtureRoot, "tsconfig.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        compilerOptions: { jsx: "react-jsx", moduleResolution: "bundler" },
        include: ["**/*.ts", "**/*.tsx"],
      }),
    );
    const snapshot = await api.updateSnapshot({ openProjects: [configPath] });
    try {
      const project = snapshot.getProjects()[0];
      if (!project) throw new Error("TypeScript fixture project not found");
      return await run(async (path) => {
        const sourceFile = await project.program.getSourceFile(join(fixtureRoot, path));
        if (!sourceFile) throw new Error(`TypeScript source file not found: ${path}`);
        return sourceFile;
      });
    } finally {
      await snapshot.dispose();
    }
  } finally {
    await api.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
};

const parseSources = (input: ReadonlyMap<string, string>): Promise<Map<string, string[]>> =>
  withFixtureProject(input, async (getSourceFile) => {
    const result = new Map<string, string[]>();
    for (const path of input.keys()) {
      result.set(
        path,
        path.endsWith(".ts") || path.endsWith(".tsx")
          ? collectSpecifiers(await getSourceFile(path))
          : [],
      );
    }
    return result;
  });

export async function extractModuleSpecifiers(source: string, fileName: string): Promise<string[]> {
  const path = fileName.replaceAll("\\", "/");
  const parsed = await parseSources(new Map([[path, source]]));
  return parsed.get(path) ?? [];
}

const withExtension = (base: string, sources: ReadonlyMap<string, string>): string | null => {
  // `${base}/index.ts(x)` は候補にしない (domain barrel は本 checker 自身が違反にするため)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
};

const resolveWebSpecifier = (
  importer: string,
  specifier: string,
  sources: ReadonlyMap<string, string>,
): string | null | undefined => {
  if (specifier.startsWith("@/")) {
    return withExtension(`web/src/${specifier.slice(2)}`, sources) ?? undefined;
  }
  if (specifier.startsWith(".")) {
    if ([".css", ".png", ".svg"].includes(extname(specifier))) return null;
    return (
      withExtension(posix.normalize(posix.join(posix.dirname(importer), specifier)), sources) ??
      undefined
    );
  }
  return null;
};

const webRelative = (path: string): string => path.replace(/^web\/src\//, "");
const moduleRoot = (path: string): string | null => {
  const root = webRelative(path).split("/")[0];
  return MODULE_ROOTS.has(root) ? root : null;
};

const findCycle = (edges: ReadonlyMap<string, ReadonlySet<string>>): string[] | null => {
  const visited = new Set<string>();
  const active: string[] = [];
  const inActive = new Set<string>();

  const visit = (node: string): string[] | null => {
    if (inActive.has(node)) {
      const start = active.indexOf(node);
      return [...active.slice(start), node];
    }
    if (visited.has(node)) return null;
    visited.add(node);
    active.push(node);
    inActive.add(node);
    for (const next of [...(edges.get(node) ?? [])].sort()) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    active.pop();
    inActive.delete(node);
    return null;
  };

  for (const node of [...edges.keys()].sort()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
};

export async function analyzeWebStructure(
  input: Record<string, string>,
  options: AnalyzeOptions = {},
): Promise<StructureResult> {
  const sources = new Map(
    Object.entries(input).map(([path, source]) => [path.replaceAll("\\", "/"), source]),
  );
  const parsed = await parseSources(sources);
  const violations: string[] = [];
  const edges = new Set<string>();
  const graph = new Map<string, Set<string>>();
  const roots = new Set<string>();
  const pageFiles = new Set<string>();
  const appTargets = new Set<string>();

  for (const path of [...sources.keys()].sort()) {
    const relativePath = webRelative(path);
    const segments = relativePath.split("/");
    const root = moduleRoot(path);
    if (root) roots.add(root);

    if (segments[0] === "pages") violations.push(`legacy root pages directory: ${relativePath}`);
    if (segments.includes("lib") || segments.includes("components")) {
      violations.push(`forbidden technical directory: ${relativePath}`);
    }
    const pagesIndex = segments.indexOf("pages");
    if (pagesIndex >= 0) {
      if (pagesIndex !== 1 || !DOMAIN_ROOTS.has(segments[0])) {
        violations.push(`invalid pages placement: ${relativePath}`);
      } else {
        pageFiles.add(path);
      }
    }
    if (root && /^index\.tsx?$/.test(segments.at(-1) ?? "")) {
      violations.push(`domain barrel file: ${relativePath}`);
    }

    for (const specifier of parsed.get(path) ?? []) {
      if (specifier.startsWith("@core/")) {
        // web/tsconfig の "@core/*" は ["./src/*", "../src/*"] の 2 candidate で、tsc は tsconfig 基準の
        // 1 つ目が web/src/ を指す (2 entry の理由は web/tsconfig.json のコメント参照)。@core specifier と
        // 同 path の file を web/src に置くと tsc と vite (../src 固定) が別 module を見る silent 乖離になる。
        const shadow = withExtension(`web/src/${specifier.slice("@core/".length)}`, sources);
        if (shadow) {
          violations.push(
            `@core specifier shadowed by web file: ${relativePath} -> ${webRelative(shadow)}`,
          );
        }
        continue;
      }
      const target = resolveWebSpecifier(path, specifier, sources);
      if (target === undefined) {
        violations.push(`unresolved web import: ${relativePath} -> ${specifier}`);
        continue;
      }
      if (target === null) continue;
      const targetRelative = webRelative(target);
      const targetRoot = moduleRoot(target);
      if (root === "app") appTargets.add(target);
      if (!root || !targetRoot || root === targetRoot) continue;

      edges.add(`${root}->${targetRoot}`);
      if (DOMAIN_ROOTS.has(root) && DOMAIN_ROOTS.has(targetRoot)) {
        const next = graph.get(root) ?? new Set<string>();
        next.add(targetRoot);
        graph.set(root, next);
      }
      if (targetRelative.includes("/pages/") && root !== "app") {
        violations.push(`domain page import is app-only: ${relativePath} -> ${targetRelative}`);
        continue;
      }
      if (root === "shared" && targetRoot !== "shared") {
        violations.push(`shared reverse dependency: ${relativePath} -> ${targetRelative}`);
        continue;
      }
      if (targetRoot === "shared") continue;
      if (!ALLOWED_CROSS_DOMAIN.get(root)?.has(targetRelative)) {
        violations.push(`cross-domain path not allowed: ${relativePath} -> ${targetRelative}`);
      }
    }
  }

  if (options.enforceTargetTree) {
    const firstLevelFiles = [...sources.keys()]
      .map(webRelative)
      .filter((path) => !path.includes("/"));
    for (const file of firstLevelFiles) {
      if (!BOOTSTRAP_FILES.has(file)) violations.push(`unexpected bootstrap file: ${file}`);
    }
    for (const expected of BOOTSTRAP_FILES) {
      if (!sources.has(`web/src/${expected}`))
        violations.push(`missing bootstrap file: ${expected}`);
    }
    const expectedRoots = [...MODULE_ROOTS].sort();
    const actualRoots = [...roots].sort();
    if (actualRoots.join("\n") !== expectedRoots.join("\n")) {
      violations.push(`module roots differ: ${actualRoots.join(",")}`);
    }
    for (const page of pageFiles) {
      if (!appTargets.has(page))
        violations.push(`page is not an app route entry: ${webRelative(page)}`);
    }
  }

  const cycle = findCycle(graph);
  if (cycle) violations.push(`domain dependency cycle: ${cycle.join(" -> ")}`);

  return {
    violations: [...new Set(violations)].sort(),
    edges: [...edges].sort(),
    roots: [...roots].sort(),
    fileCount: sources.size,
  };
}

export function readActualWebSources(): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".css")) {
        const path = `web/src/${relative(WEB_SRC, full).replaceAll("\\", "/")}`;
        result[path] = readFileSync(full, "utf8");
      }
    }
  };
  walk(WEB_SRC);
  return result;
}
