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

const WEB_SRC = join(REPO_ROOT, "web/src");

const DOMAIN_ROOTS = new Set(["account", "auth", "company", "invitation", "membership", "mfa"]);

const BOOTSTRAP_FILES = new Set(["index.css", "main.ts", "vite-env.d.ts"]);

const MODULE_ROOTS = new Set([...DOMAIN_ROOTS, "app", "shared"]);

type AnalyzeOptions = {
  enforceTargetTree?: boolean;
};

export type StructureResult = {
  violations: string[];
  roots: string[];
  fileCount: number;
};

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

type Scan = {
  readonly sources: ReadonlyMap<string, string>;
  readonly violations: string[];
  readonly roots: Set<string>;
  readonly pageFiles: Set<string>;
  readonly appTargets: Set<string>;
};

const isDomainPageSegments = (segments: readonly string[]): boolean =>
  segments.indexOf("pages") === 1 && DOMAIN_ROOTS.has(segments[0] ?? "");

const PLACEMENT_RULES: readonly {
  readonly violates: (segments: readonly string[], root: string | null) => boolean;
  readonly message: string;
}[] = [
  { violates: (segments) => segments[0] === "pages", message: "legacy root pages directory" },
  {
    violates: (segments) => segments.includes("lib") || segments.includes("components"),
    message: "forbidden technical directory",
  },
  {
    violates: (segments) => segments.includes("pages") && !isDomainPageSegments(segments),
    message: "invalid pages placement",
  },
  {
    violates: (segments, root) => root !== null && /^index\.tsx?$/.test(segments.at(-1) ?? ""),
    message: "domain barrel file",
  },
];

const placementViolations = (path: string, root: string | null): string[] => {
  const relativePath = webRelative(path);
  const segments = relativePath.split("/");
  return PLACEMENT_RULES.filter(({ violates }) => violates(segments, root)).map(
    ({ message }) => `${message}: ${relativePath}`,
  );
};

const isDomainPage = (path: string): boolean => isDomainPageSegments(webRelative(path).split("/"));

const scanCoreSpecifier = (scan: Scan, path: string, specifier: string): void => {
  const shadow = withExtension(`web/src/${specifier.slice("@core/".length)}`, scan.sources);
  if (shadow) {
    scan.violations.push(
      `@core specifier shadowed by web file: ${webRelative(path)} -> ${webRelative(shadow)}`,
    );
  }
};

const scanSpecifier = (scan: Scan, path: string, root: string | null, specifier: string): void => {
  if (specifier.startsWith("@core/")) {
    scanCoreSpecifier(scan, path, specifier);
    return;
  }
  const target = resolveWebSpecifier(path, specifier, scan.sources);
  if (target === undefined) {
    scan.violations.push(`unresolved web import: ${webRelative(path)} -> ${specifier}`);
    return;
  }
  if (target !== null && root === "app") {
    scan.appTargets.add(target);
  }
};

const targetTreeViolations = (scan: Scan): string[] => {
  const firstLevelFiles = [...scan.sources.keys()]
    .map(webRelative)
    .filter((path) => !path.includes("/"));
  const actualRoots = [...scan.roots].sort();
  return [
    ...firstLevelFiles
      .filter((file) => !BOOTSTRAP_FILES.has(file))
      .map((file) => `unexpected bootstrap file: ${file}`),
    ...[...BOOTSTRAP_FILES]
      .filter((expected) => !scan.sources.has(`web/src/${expected}`))
      .map((expected) => `missing bootstrap file: ${expected}`),
    ...(actualRoots.join("\n") === [...MODULE_ROOTS].sort().join("\n")
      ? []
      : [`module roots differ: ${actualRoots.join(",")}`]),
    ...[...scan.pageFiles]
      .filter((page) => !scan.appTargets.has(page))
      .map((page) => `page is not an app route entry: ${webRelative(page)}`),
  ];
};

export async function analyzeWebStructure(
  input: Record<string, string>,
  options: AnalyzeOptions = {},
): Promise<StructureResult> {
  const sources = new Map(
    Object.entries(input).map(([path, source]) => [path.replaceAll("\\", "/"), source]),
  );
  const parsed = await parseSources(sources);
  const scan: Scan = {
    sources,
    violations: [],
    roots: new Set(),
    pageFiles: new Set(),
    appTargets: new Set(),
  };

  for (const path of [...sources.keys()].sort()) {
    const root = moduleRoot(path);
    if (root) {
      scan.roots.add(root);
    }
    scan.violations.push(...placementViolations(path, root));
    if (isDomainPage(path)) {
      scan.pageFiles.add(path);
    }
    for (const specifier of parsed.get(path) ?? []) {
      scanSpecifier(scan, path, root, specifier);
    }
  }

  if (options.enforceTargetTree) {
    scan.violations.push(...targetTreeViolations(scan));
  }

  return {
    violations: [...new Set(scan.violations)].sort(),
    roots: [...scan.roots].sort(),
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
