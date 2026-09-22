import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// biome.json の 2 copy と byte 単位で一致させる (message は selector なので、ずれると invariant が無効になる)。
export const WEB_ONLY_DEP_MESSAGE =
  "web 専用 devDependency のため server runtime に存在しない。server で必要になったら dependencies へ戻す (docs/adr/0014-docker-runner-dev-stage-separation.md)";
const CONNECT_NODE_BAN_MESSAGE = "削除済み依存。再導入しない (ADR-0011 / ADR-0014)";

// biome の override は merge されず置き換わるため、ban は src 系にマッチする 2 つの override へ意図的に重複コピーしてある。
export const EXPECTED_WEB_ONLY_COPY_COUNT = 2;
export const EXPECTED_CONNECT_NODE_COPY_COUNT = 2;

// override[0] が覆う 3 scope に 1 つずつ。後置 override の後勝ち置換で ban が消える経路を scope ごとに検出する。
export const REPRESENTATIVE_SERVER_FILE = "src/handlers/account-company.ts";
export const REPRESENTATIVE_DB_FILE = "db/schema.ts";
export const REPRESENTATIVE_MANAGEMENT_FILE = "management/disable-user-mfa.ts";
const REPRESENTATIVE_BANNED_SCOPE_FILES = [
  REPRESENTATIVE_SERVER_FILE,
  REPRESENTATIVE_DB_FILE,
  REPRESENTATIVE_MANAGEMENT_FILE,
];

export const CONNECT_NODE = "@connectrpc/connect-node";
const BIOME_CONFIG_CANDIDATES = ["biome.json", "biome.jsonc"];

export interface RestrictedPattern {
  group?: string[];
  message?: string;
}

export interface BiomeOverride {
  includes?: string[];
  linter?: {
    rules?: {
      style?: {
        noRestrictedImports?: {
          options?: {
            paths?: Record<string, unknown>;
            patterns?: RestrictedPattern[];
          };
        };
      };
    };
  };
}

export interface BiomeConfig {
  overrides?: BiomeOverride[];
}

export function parseJsonc(text: string): BiomeConfig {
  const withoutComments = text
    .replace(/"(?:[^"\\]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match) =>
      match.startsWith('"') ? match : " ",
    )
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(withoutComments) as BiomeConfig;
}

export function restrictedPatterns(override: BiomeOverride): RestrictedPattern[] {
  return override.linter?.rules?.style?.noRestrictedImports?.options?.patterns ?? [];
}

export function webOnlyGroupOf(override: BiomeOverride): string[] | null {
  const found = restrictedPatterns(override).find((p) => p.message === WEB_ONLY_DEP_MESSAGE);
  return found?.group ?? null;
}

// index ではなく message で探す (override[1] は web group が patterns[1] にあり、override[4] の SDK ban は文言が違う)。
export function webOnlyGroups(config: BiomeConfig): string[][] {
  const groups: string[][] = [];
  for (const override of config.overrides ?? []) {
    const group = webOnlyGroupOf(override);
    if (group !== null) groups.push(group);
  }
  return groups;
}

// biome 2.4.14 の includes は最後にマッチした pattern が勝つ (実測)。positive/negative の集合分離だと `["!src/auth.ts", "src/**"]` を誤除外する。
export function overrideMatches(override: BiomeOverride, path: string): boolean {
  let included = false;
  for (const pattern of override.includes ?? []) {
    const negated = pattern.startsWith("!");
    if (new Bun.Glob(negated ? pattern.slice(1) : pattern).match(path)) included = !negated;
  }
  return included;
}

export function effectiveOverride(config: BiomeConfig, path: string): BiomeOverride | null {
  let effective: BiomeOverride | null = null;
  for (const override of config.overrides ?? []) {
    if (!overrideMatches(override, path)) continue;
    if (override.linter?.rules?.style?.noRestrictedImports !== undefined) effective = override;
  }
  return effective;
}

export function effectiveWebOnlyGroup(config: BiomeConfig, path: string): string[] | null {
  const effective = effectiveOverride(config, path);
  return effective === null ? null : webOnlyGroupOf(effective);
}

export function hasConnectNodeBan(override: BiomeOverride): boolean {
  return restrictedPatterns(override).some(
    (p) => p.message === CONNECT_NODE_BAN_MESSAGE && (p.group ?? []).includes(CONNECT_NODE),
  );
}

export function webOnlyBanViolations(config: BiomeConfig): string[] {
  const violations: string[] = [];
  const sorted = webOnlyGroups(config).map((group) => [...group].sort());

  if (sorted.length !== EXPECTED_WEB_ONLY_COPY_COUNT) {
    violations.push(
      `web 専用 ban の copy 数が ${sorted.length} 個 (期待 ${EXPECTED_WEB_ONLY_COPY_COUNT} 個)。message 文言を変えたなら biome.json の 2 copy と本 test の WEB_ONLY_DEP_MESSAGE を同時に直す (期待 message: ${WEB_ONLY_DEP_MESSAGE})`,
    );
  }
  for (const [index, group] of sorted.entries()) {
    const diff = symmetricDifference(group, sorted[0] ?? []);
    if (diff.length > 0) {
      violations.push(
        `web 専用 group が override 間で食い違う (copy ${index} との差分: ${diff.join(", ")})。biome.json の 2 つの override group を同一内容に保つ`,
      );
    }
  }
  for (const path of REPRESENTATIVE_BANNED_SCOPE_FILES) {
    const effective = effectiveWebOnlyGroup(config, path);
    if (effective === null || symmetricDifference(effective, sorted[0] ?? []).length > 0) {
      violations.push(
        `${path} に最後にマッチする override が web 専用 ban を持っていない。同じ path にマッチする override を後ろに足すと biome の後勝ち置換で ban が実効的に消える`,
      );
    }
  }
  return violations;
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
    "直す場所: biome.json の 2 つの override group (message が WEB_ONLY_DEP_MESSAGE のもの) と、本 test の ALLOWED_DEV_DEPENDENCIES (許可するなら build-tool / type-only / test-only-runtime のいずれかの理由を書く)";
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

// `--platform=` flag、小文字の as、行末コメント、名前なし FROM を許容する (厳密な正規表現だと最終 stage の検査が空振りで通る)。
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

// denylist だと `COPY . .` や新設 source ディレクトリがすり抜けるので allowlist。
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

// ADR-0009 §A。大文字 hex と `# v4.2.2 (pinned)` のような補足は供給元が変わらないので許す。
const PINNED_USES = /^\s*-?\s*uses:\s*\S+@[0-9a-fA-F]{40}\s+#\s*v\S+(\s.*)?$/;

// ローカルの composite action は pin できる SHA が無い。
const LOCAL_USES = /^\s*-?\s*uses:\s*\.{1,2}\//;

// pin 判定と件数 guard が同じ selector を使う (別々だと「対象 0 行で緑」を guard が検出できない)。
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

export function readBiomeConfig(): BiomeConfig {
  for (const name of BIOME_CONFIG_CANDIDATES) {
    const path = join(REPO_ROOT, name);
    if (existsSync(path)) return parseJsonc(readFileSync(path, "utf8"));
  }
  throw new Error(`biome 設定が見つからない (${BIOME_CONFIG_CANDIDATES.join(" / ")})`);
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
