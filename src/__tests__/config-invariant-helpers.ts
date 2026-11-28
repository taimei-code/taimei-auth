import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { REPO_ROOT } from "./source-scan";

export { REPO_ROOT };

export const readEnvFile = (path: string) =>
  parseEnv(readFileSync(path, "utf8")) as Record<string, string>;

type OxlintRuleSeverities = Readonly<Record<string, unknown>>;

export interface OxlintOverride {
  files: string[];
  rules?: OxlintRuleSeverities;
}

export interface OxlintConfig {
  rules?: OxlintRuleSeverities;
  overrides?: OxlintOverride[];
}

export function parseJsonc(text: string): unknown {
  const withoutComments = text
    .replace(/"(?:[^"\\]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match) =>
      match.startsWith('"') ? match : " ",
    )
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(withoutComments);
}

export interface ClassificationDiff {
  missingFromBan: string[];
  bannedButAllowed: string[];
  staleBanPatterns: string[];
}

export function classificationDiff(
  devDependencies: string[],
  allowed: Record<string, string>,
  banGroup: string[],
): ClassificationDiff {
  const banned = new Set<string>();
  const staleBanPatterns: string[] = [];
  for (const pattern of banGroup) {
    const glob = new Bun.Glob(pattern);
    const hits = devDependencies.filter((dep) => glob.match(dep));
    if (hits.length === 0) staleBanPatterns.push(pattern);
    for (const hit of hits) banned.add(hit);
  }
  const expected = devDependencies.filter((dep) => !Object.hasOwn(allowed, dep));
  return {
    missingFromBan: expected.filter((dep) => !banned.has(dep)),
    bannedButAllowed: [...banned].filter((dep) => Object.hasOwn(allowed, dep)),
    staleBanPatterns,
  };
}

export function classificationViolations(diff: ClassificationDiff): string[] {
  const violations: string[] = [];
  const fixHint =
    "直す場所: lint/oxlint-plugin.mts の WEB_ONLY_DEPENDENCIES と、本 test の ALLOWED_DEV_DEPENDENCIES (許可するなら build-tool / type-only / test-only-runtime のいずれかの理由を書く)";
  if (diff.missingFromBan.length > 0) {
    violations.push(
      `web 専用 ban にも許可リストにも無い devDependency: ${diff.missingFromBan.join(", ")}。${fixHint}`,
    );
  }
  if (diff.bannedButAllowed.length > 0) {
    violations.push(
      `ban と許可リストの両方に載っている devDependency: ${diff.bannedButAllowed.join(", ")}。${fixHint}`,
    );
  }
  if (diff.staleBanPatterns.length > 0) {
    violations.push(
      `どの devDependency にも当たらない ban entry: ${diff.staleBanPatterns.join(", ")}。${fixHint}`,
    );
  }
  return violations;
}

function fromTokens(line: string): string[] | null {
  const match = /^\s*FROM\s+(.+)$/i.exec(line.replace(/#.*$/, ""));
  if (match === null) return null;
  const tokens = (match[1] as string)
    .trim()
    .split(/\s+/)
    .filter((token) => !token.startsWith("--"));
  return tokens.length === 0 ? null : tokens;
}

function fromStageName(line: string): string | null {
  const tokens = fromTokens(line);
  if (tokens === null) return null;
  const asIndex = tokens.findIndex((token) => token.toUpperCase() === "AS");
  return asIndex === -1 ? null : (tokens[asIndex + 1] ?? null);
}

function stageBody(dockerfile: string, stage: string): string | null {
  const lines = dockerfile.split("\n");
  const start = lines.findIndex((line) => fromStageName(line) === stage);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => fromTokens(line) !== null);
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

interface CopyInstruction {
  sources: string[];
  dest: string;
}

function normalizeCopyPath(token: string): string {
  return token.replace(/^\.\//, "").replace(/\/+$/, "");
}

function copyInstructions(stage: string): CopyInstruction[] {
  return stage.split("\n").flatMap((line) => {
    const match = /^COPY\s+(.+)$/.exec(line.trim());
    if (match === null) return [];
    const tokens = (match[1] as string).split(/\s+/).filter((token) => !token.startsWith("--"));
    if (tokens.length < 2) return [];
    return [
      {
        sources: tokens.slice(0, -1).map(normalizeCopyPath),
        dest: normalizeCopyPath(tokens.at(-1) as string),
      },
    ];
  });
}

const MANIFEST_SOURCE = /^(package\.json|bun\.lock|packages\/[^/]+\/package\.json)$/;

export function dockerfileViolations(dockerfile: string, workspacePackages: string[]): string[] {
  const violations: string[] = [];

  const manifests = stageBody(dockerfile, "manifests");
  if (manifests === null) {
    violations.push("Dockerfile に manifests stage が無い");
  } else {
    const copiedSources = copyInstructions(manifests).flatMap((copy) => copy.sources);
    const offending = copiedSources.filter((source) => !MANIFEST_SOURCE.test(source));
    if (offending.length > 0) {
      violations.push(
        `manifests stage が manifest 以外を COPY している (${offending.join(", ")})。install layer が source 編集で無効化されるので、manifest (package.json / bun.lock / packages/*/package.json) だけに絞る`,
      );
    }

    for (const name of workspacePackages) {
      const manifestPath = `packages/${name}/package.json`;
      if (!copiedSources.includes(manifestPath)) {
        violations.push(
          `manifests stage に workspace package ${name} の manifest COPY が無い。次の 1 行を manifests stage に足す: COPY ${manifestPath} ./${manifestPath}`,
        );
      }
    }
  }

  const deps = stageBody(dockerfile, "deps");
  if (deps === null) {
    violations.push("Dockerfile に deps stage が無い");
  } else {
    const install = deps.search(/^RUN\s+.*\bbun install\b/m);
    const copy = deps.search(/^COPY\s+packages\s+\.\/packages(\s|$)/m);
    if (install === -1) violations.push("deps stage に bun install が無い");
    if (copy === -1) violations.push("deps stage に COPY packages ./packages が無い");
    if (install !== -1 && copy !== -1 && copy < install) {
      violations.push(
        "deps stage で COPY packages ./packages が bun install より前にある。source 編集が install layer を無効化するので COPY は install の後に置く",
      );
    }
  }

  const stageNames = dockerfile.split("\n").flatMap((line) => {
    return fromTokens(line) === null ? [] : [fromStageName(line)];
  });
  if (stageNames.length === 0) {
    violations.push("Dockerfile に FROM が無い");
  } else {
    const last = stageNames.at(-1);
    if (last !== "dev") {
      violations.push(
        `Dockerfile の最後の stage が dev でない (実際: ${last ?? "名前なし FROM"})。既定 build target = full toolchain の dev は consumer repo との契約`,
      );
    }
  }

  return violations;
}

const PINNED_USES = /^\s*-?\s*uses:\s*\S+@[0-9a-fA-F]{40}\s+#\s*v\S+(\s.*)?$/;

const LOCAL_USES = /^\s*-?\s*uses:\s*\.{1,2}\//;

export function usesLines(workflow: string): string[] {
  return workflow
    .split("\n")
    .filter((line) => /^\s*-?\s*uses:/.test(line) && !LOCAL_USES.test(line));
}

export function workflowPinViolations(workflow: string, label: string): string[] {
  return usesLines(workflow)
    .filter((line) => !PINNED_USES.test(line))
    .map(
      (line) =>
        `${label}: uses が 40 桁 commit SHA + version コメント形式でない (ADR-0009 §A): ${line.trim()}`,
    );
}

export function symmetricDifference(a: string[], b: string[]): string[] {
  return [...a.filter((x) => !b.includes(x)), ...b.filter((x) => !a.includes(x))];
}

export function readOxlintConfig(): OxlintConfig {
  return parseJsonc(readFileSync(join(REPO_ROOT, ".oxlintrc.json"), "utf8")) as OxlintConfig;
}

let effectTsgoExecutable: string | undefined;

export function effectTsgo(): string {
  if (effectTsgoExecutable === undefined) {
    const resolved = spawnSync(join(REPO_ROOT, "node_modules/.bin/effect-tsgo"), ["get-exe-path"], {
      encoding: "utf8",
    }).stdout.trim();
    if (!existsSync(resolved)) {
      throw new Error(`effect-tsgo の実行 file を解決できない: ${resolved}`);
    }
    effectTsgoExecutable = resolved;
  }
  return effectTsgoExecutable;
}

export function readPackageJson(): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
}

export function workflowFileNames(): string[] {
  return readdirSync(join(REPO_ROOT, ".github/workflows")).filter((name) => /\.ya?ml$/.test(name));
}

export function workspacePackageNames(): string[] {
  const packagesDir = join(REPO_ROOT, "packages");
  return readdirSync(packagesDir).filter((name) =>
    existsSync(join(packagesDir, name, "package.json")),
  );
}

export const NON_PRODUCTION_DIRS = ["db/testing", "testing", "web/non-production"];

export const DEVELOPMENT_REFERENCE_DIRS = ["repos"];

export const readWorkflow = <Workflow>(name: string): Workflow =>
  Bun.YAML.parse(readFileSync(join(REPO_ROOT, ".github/workflows", name), "utf8")) as Workflow;

export const indexOfStepRunning = (steps: readonly { run?: string }[], fragment: string): number =>
  steps.findIndex(({ run = "" }) => run.includes(fragment));

type BunVersionPin = { readonly place: string; readonly version: unknown };

type SetupStep = { readonly uses?: string; readonly with?: Record<string, unknown> };

type StepsFile = {
  readonly jobs?: Record<string, { readonly steps?: readonly SetupStep[] }>;
  readonly runs?: { readonly steps?: readonly SetupStep[] };
};

export function setupBunPins(yaml: string, place: string): BunVersionPin[] {
  const parsed = (Bun.YAML.parse(yaml) ?? {}) as StepsFile;
  const steps = [
    ...Object.values(parsed.jobs ?? {}).flatMap((job) => job.steps ?? []),
    ...(parsed.runs?.steps ?? []),
  ];
  return steps
    .filter((step) => step.uses?.startsWith("oven-sh/setup-bun@"))
    .map((step) => ({ place, version: step.with?.["bun-version"] }));
}

export function dockerBunPins(dockerfile: string): BunVersionPin[] {
  return dockerfile.split("\n").flatMap((line) => {
    const image = fromTokens(line)?.[0];
    return image?.startsWith("oven/bun:")
      ? [{ place: "Dockerfile", version: image.slice("oven/bun:".length) }]
      : [];
  });
}

export function bunVersionPinsInRepo(): BunVersionPin[] {
  const actionsDir = join(REPO_ROOT, ".github/actions");
  const actionFiles = readdirSync(actionsDir).flatMap((name) =>
    ["action.yml", "action.yaml"]
      .map((file) => `.github/actions/${name}/${file}`)
      .filter((path) => existsSync(join(REPO_ROOT, path))),
  );
  const workflowFiles = workflowFileNames().map((name) => `.github/workflows/${name}`);
  return [
    ...dockerBunPins(readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8")),
    ...[...workflowFiles, ...actionFiles].flatMap((path) =>
      setupBunPins(readFileSync(join(REPO_ROOT, path), "utf8"), path),
    ),
  ];
}

export function bunVersionPinViolations(pins: readonly BunVersionPin[]): string[] {
  const unpinned = pins
    .filter((pin) => pin.version === undefined)
    .map((pin) => `${pin.place}: setup-bun が bun-version を固定していない`);
  const unquoted = pins
    .filter((pin) => pin.version !== undefined && typeof pin.version !== "string")
    .map(
      (pin) =>
        `${pin.place}: setup-bun の bun-version (${String(pin.version)}) を引用符で囲む。囲まないと YAML が数として読み、1.10 が 1.1 になる`,
    );
  const versions = new Set(
    pins.flatMap((pin) => (typeof pin.version === "string" ? [pin.version] : [])),
  );
  const split =
    versions.size > 1
      ? [
          `Bun の版が場所によって分かれている (${pins.map((pin) => `${pin.place}=${String(pin.version)}`).join(", ")})。手元、CI、Docker、deploy で同じ Bun を使うため、すべて同じ版にそろえる`,
        ]
      : [];
  return [...unpinned, ...unquoted, ...split];
}
