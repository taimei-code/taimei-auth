import { execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
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

// web/src のドメイン構造 (ADR-0015 / web/src/CLAUDE.md) を固定する検査群。役割は 2 種に分かれる:
// - 恒久 architecture test: analyzeWebStructure (cross-domain allowlist / pages 規則 / shared 逆依存 /
//   cycle)。新しい cross-domain interface を設ける時は ALLOWED_CROSS_DOMAIN に file path を足し、
//   設計変更として review する。
// - 移行完了 witness (plan AC-142〜144): move manifest 照合 / APPROVED_CHANGED_PATHS /
//   STALE_REFERENCE_PATTERNS。baseline 91dde8a 時点の移行を固定する一度きりの検査で、
//   恒久規則ではない。

const WEB_SRC = join(REPO_ROOT, "web/src");

const DOMAIN_ROOTS = new Set(["account", "auth", "company", "invitation", "membership", "mfa"]);
const MODULE_ROOTS = new Set([...DOMAIN_ROOTS, "app", "shared"]);
const BOOTSTRAP_FILES = new Set(["index.css", "main.tsx", "vite-env.d.ts"]);

const APPROVED_CHANGED_PATHS = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
  "biome.json",
  "db/AGENTS.md",
  "db/CLAUDE.md",
  "docs/adr/0002-spa-routing-and-static-assets.md",
  "docs/adr/0005-canary-token-embedding.md",
  "docs/adr/0006-sdk-encapsulation.md",
  "docs/adr/0008-avatar-immediate-persist.md",
  "docs/adr/0010-company-account-deletion-lifecycle.md",
  "docs/adr/0012-layered-architecture.md",
  "docs/adr/0013-mfa-totp-challenge.md",
  "docs/adr/0014-docker-runner-dev-stage-separation.md",
  "docs/adr/0015-web-domain-first-directory-structure.md",
  "docs/qa/manual-regression.md",
  "packages/auth-client/AGENTS.md",
  "packages/auth-client/CLAUDE.md",
  "src/AGENTS.md",
  "src/CLAUDE.md",
  "e2e/company-delete.e2e.ts",
  "e2e/helpers.ts",
  "src/__tests__/routes-integration.test.ts",
  "src/__tests__/web-shared-core-runtime-free.test.ts",
  "web/tailwind.config.ts",
  "src/__tests__/web-domain-structure-helpers.ts",
  "src/__tests__/web-domain-move-manifest.ts",
  "src/__tests__/web-domain-structure.test.ts",
  "src/app.ts",
  "src/company/__tests__/org-code.test.ts",
  "src/company/org-code.ts",
  "src/handlers/account-company.ts",
  "src/handlers/auth-entry-redirect.ts",
  "src/invitation/accept-path.ts",
  "src/membership/__tests__/policy.test.ts",
  "src/membership/policy.ts",
  "src/sign-in-params.ts",
  "web/components.json",
]);

const LEGACY_LIB_IMPORTS = [
  "account-api",
  "auth-client",
  "auth-redirect",
  "company-context",
  "labels",
  "mfa-api",
  "mfa-challenge-flow",
  "session-guard",
  "sign-params",
  "use-async-load",
  "use-mfa-challenge-flow",
  "use-mfa-code-entry",
  "use-sign-page",
  "utils",
];

const STALE_REFERENCE_PATTERNS = [
  ...LEGACY_LIB_IMPORTS.map((module) => `@/lib/${module}`),
  "@/components/CanaryTokens",
  "@/components/ConfirmDestructiveDialog",
  "@/components/FullScreenLoader",
  "@/components/PhishingBanner",
  "@/components/account/",
  "@/components/auth/",
  "@/components/notify",
  "@/components/ui/",
  "web/src/lib/",
  "web/src/components/",
  "web/src/pages/",
  "components/notify.tsx",
  "lib/auth-redirect.ts",
];

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

export type MoveManifestEntry = {
  baselinePath: string;
  currentPath: string;
  normalizedSha256: string;
};

export type RawManifestEntry = {
  baselinePath: string;
  currentPath: string;
  rawSha256: string;
};

const sha256 = (source: string): string => createHash("sha256").update(source).digest("hex");

export async function findMoveManifestMismatches(
  entries: readonly MoveManifestEntry[],
  readCurrent: (path: string) => string = (path) => readFileSync(join(REPO_ROOT, path), "utf8"),
): Promise<string[]> {
  // 全 entry を 1 つの fixture project でまとめて正規化する (file ごとに project を建てると
  // tsgo process 起動 ~50ms × 50 file が全 PR の CI に載る)。
  const normalized = await normalizeTypeScriptStructures(
    new Map(entries.map((entry) => [entry.currentPath, readCurrent(entry.currentPath)])),
  );
  return entries
    .flatMap((entry) => {
      const normalizedSource = normalized.get(entry.currentPath);
      if (normalizedSource === undefined) {
        throw new Error(`TypeScript normalization source not found: ${entry.currentPath}`);
      }
      const actual = sha256(normalizedSource);
      return actual === entry.normalizedSha256
        ? []
        : [
            `${entry.currentPath}: normalized digest mismatch (baseline ${entry.baselinePath}, expected ${entry.normalizedSha256}, actual ${actual})`,
          ];
    })
    .sort();
}

export function findRawManifestMismatches(
  entries: readonly RawManifestEntry[],
  readCurrent: (path: string) => string = (path) => readFileSync(join(REPO_ROOT, path), "utf8"),
): string[] {
  return entries
    .flatMap((entry) => {
      const actual = sha256(readCurrent(entry.currentPath));
      return actual === entry.rawSha256
        ? []
        : [
            `${entry.currentPath}: raw digest mismatch (baseline ${entry.baselinePath}, expected ${entry.rawSha256}, actual ${actual})`,
          ];
    })
    .sort();
}

export function findUnapprovedChangedPaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => path.replaceAll("\\", "/")))]
    .filter((path) => !path.startsWith("web/src/") && !APPROVED_CHANGED_PATHS.has(path))
    .sort();
}

export function findStaleReferences(
  sources: Readonly<Record<string, string>>,
  allowedPaths: ReadonlySet<string> = new Set(),
): string[] {
  const findings: string[] = [];
  for (const [rawPath, source] of Object.entries(sources)) {
    const path = rawPath.replaceAll("\\", "/");
    if (allowedPaths.has(path)) continue;
    for (const [lineIndex, line] of source.split("\n").entries()) {
      if (STALE_REFERENCE_PATTERNS.some((pattern) => line.includes(pattern))) {
        findings.push(`${path}:${lineIndex + 1}: ${line.trim()}`);
      }
    }
  }
  return findings.sort();
}

// 完了 witness (AC-143/144) の走査対象。commit 前の worktree で検証する前提で、tracked の変更と
// untracked を git から取る (merge 後の clean tree では空集合になり無害化する)。
const gitLines = (command: string): string[] =>
  execSync(command, { cwd: REPO_ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

export const readWorkingTreeChangedPaths = (): string[] => [
  ...gitLines("git diff --name-only HEAD"),
  ...gitLines("git ls-files --others --exclude-standard"),
];

// 旧 path 文字列を意図的に保持する file (baseline manifest / stale pattern 定義 / その fixture)。
export const HISTORICAL_STALE_ALLOWLIST: ReadonlySet<string> = new Set([
  "src/__tests__/web-domain-move-manifest.ts",
  "src/__tests__/web-domain-structure-helpers.ts",
  "src/__tests__/web-domain-structure.test.ts",
]);

const TEXT_EXTENSIONS = [".ts", ".tsx", ".md", ".json", ".yml", ".yaml", ".toml", ".css"];

export const readRepoTextSources = (): Record<string, string> => {
  const result: Record<string, string> = {};
  const paths = [
    ...gitLines("git ls-files"),
    ...gitLines("git ls-files --others --exclude-standard"),
  ];
  for (const path of paths) {
    if (!TEXT_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;
    const full = join(REPO_ROOT, path);
    if (!existsSync(full)) continue; // worktree で削除済みの tracked path
    result[path] = readFileSync(full, "utf8");
  }
  return result;
};

// import 宣言 / re-export / literal dynamic import の module specifier。digest 正規化と依存 graph の
// 双方がこの 1 判定を共有する (二重実装だと import 形式を足した時に片側だけ増えて silent に食い違う)。
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

const normalizedNode = (
  node: Node,
  sourceFile: SourceFile,
  moduleNodes: ReadonlySet<Node>,
): string => {
  if (moduleNodes.has(node)) return `${node.kind}:<module>`;
  const children: string[] = [];
  node.forEachChild((child) => {
    children.push(normalizedNode(child, sourceFile, moduleNodes));
  });
  if (children.length > 0) return `${node.kind}(${children.join(",")})`;
  const text = node.getText(sourceFile);
  if (/^\{\/\*[\s\S]*\*\/\}$/.test(text)) return `${node.kind}:<comment>`;
  return `${node.kind}:${text}`;
};

const normalizedSourceFile = (sourceFile: SourceFile): string => {
  const moduleNodes = new Set<Node>();
  const collectModules = (node: Node): void => {
    const specifier = moduleSpecifierOf(node);
    if (specifier) moduleNodes.add(specifier);
    node.forEachChild(collectModules);
  };
  collectModules(sourceFile);

  const imports: string[] = [];
  const body: string[] = [];
  for (const statement of sourceFile.statements) {
    const normalized = normalizedNode(statement, sourceFile, moduleNodes);
    if (isImportDeclaration(statement) || isExportDeclaration(statement)) imports.push(normalized);
    else body.push(normalized);
  }
  return JSON.stringify({ imports: imports.sort(), body });
};

const normalizeTypeScriptStructures = (
  sources: ReadonlyMap<string, string>,
): Promise<Map<string, string>> =>
  withFixtureProject(sources, async (getSourceFile) => {
    const result = new Map<string, string>();
    for (const path of sources.keys()) {
      result.set(path, normalizedSourceFile(await getSourceFile(path)));
    }
    return result;
  });

export async function normalizeTypeScriptStructure(
  source: string,
  fileName: string,
): Promise<string> {
  const path = fileName.replaceAll("\\", "/");
  const normalized = (await normalizeTypeScriptStructures(new Map([[path, source]]))).get(path);
  if (normalized === undefined) {
    throw new Error(`TypeScript normalization source not found: ${path}`);
  }
  return normalized;
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
