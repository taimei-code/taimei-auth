// 依存分類 (どの package が runner image に載るか) / docker build 契約 / action pin は、設定ファイル
// 同士の整合でしか成立していない — biome の ban list / package.json の section / Dockerfile の stage
// 構成 / workflow の action pin。どれかが片側だけ動いても lint も typecheck も build も緑のままなので、
// 設定を text として読んで drift を検出する (web-shared-core-runtime-free.test.ts と同型)。
// 本 file は各 invariant test (dependency-classification / dockerfile-contract / workflow-action-pin /
// sdk-boundary-ban) が共有する純関数と定数を持つ。`.test.ts` でないため bun test は実行しない。
//
// これらの test は banned package を一切 import せず設定を読むだけなので、検査対象の override 群と
// 干渉しない。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// biome.json の該当 message と byte 単位で一致させる。文言を直すときは biome.json の 2 copy と
// 本定数を同時に直すこと (message は override 横断の selector なので、片方だけ直すと selector が
// 空振りして invariant が silent に消える)。
export const WEB_ONLY_DEP_MESSAGE =
  "web 専用 devDependency のため server runtime (runner image) に存在しない。server で必要になったら dependencies へ戻す (docs/adr/0014-docker-runner-dev-stage-separation.md)";
export const CONNECT_NODE_BAN_MESSAGE = "削除済み依存。再導入しない (ADR-0011 / ADR-0014)";

// biome の override は merge されず置換されるため、classification の ban は src 系にマッチする
// 2 つの override に意図的に重複コピーされている (統合しない)。
export const EXPECTED_WEB_ONLY_COPY_COUNT = 2;
// connect-node ban も同じ 2 つの override に重複コピーされているが、web 専用 ban とは
// 独立に増減し得るので別定数にする (同じ数字でも意味が違うものを共有すると、片方を直した
// ときにもう片方の失敗メッセージが嘘の直し方を案内する)。
export const EXPECTED_CONNECT_NODE_COPY_COUNT = 2;

// 「最後にマッチする override が ban を持っているか」を実効内容で見るための代表 path。
// 出現回数と集合一致だけでは、同じ path にマッチする override を後ろに足して後勝ち置換で ban を
// 打ち消す経路が 2 copy 健在のまま素通りする。override[0] が覆う 3 scope
// (src/** / db/** / management/**) から実在 file を 1 本ずつ採る (src だけだと、db / management に
// 後置 override を足して ban を消す経路が検出できない)。
export const REPRESENTATIVE_SERVER_FILE = "src/handlers/account-company.ts";
export const REPRESENTATIVE_DB_FILE = "db/schema.ts";
export const REPRESENTATIVE_MANAGEMENT_FILE = "management/disable-user-mfa.ts";
export const REPRESENTATIVE_BANNED_SCOPE_FILES = [
  REPRESENTATIVE_SERVER_FILE,
  REPRESENTATIVE_DB_FILE,
  REPRESENTATIVE_MANAGEMENT_FILE,
];

export const CONNECT_NODE = "@connectrpc/connect-node";
const BIOME_CONFIG_CANDIDATES = ["biome.json", "biome.jsonc"];

// ---- 純関数 (in-memory fixture でも同じ判定を回せるよう、file 読込みと分離する) ----------------

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

// biome.json にコメントを足す / .jsonc 化する、といった正当な変更でこの invariant test が
// 無関係な SyntaxError で死なないようにする。
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

// index 参照は禁止: override[1] では web group が patterns[1] にあり index が既にズレている。
// message 文字列で探索すれば、文言の違う override[4] (SDK の framework 非依存 ban — 正本は
// packages/auth-client/CLAUDE.md) は paths / patterns の表現差に依存せず自然に除外される。
export function webOnlyGroups(config: BiomeConfig): string[][] {
  const groups: string[][] = [];
  for (const override of config.overrides ?? []) {
    const group = webOnlyGroupOf(override);
    if (group !== null) groups.push(group);
  }
  return groups;
}

// biome 2.4.14 の `includes` は「順に評価して最後にマッチした pattern が勝つ」semantics
// (実測)。positive 集合と negative 集合を分けて `matched && !excluded` にすると、negation の
// 後ろに positive を置いて絞りを解除する書き方 (`["!src/auth.ts", "src/**"]`) を誤って
// 除外扱いにする。どの pattern にもマッチしなければ対象外。
export function overrideMatches(override: BiomeOverride, path: string): boolean {
  let included = false;
  for (const pattern of override.includes ?? []) {
    const negated = pattern.startsWith("!");
    if (new Bun.Glob(negated ? pattern.slice(1) : pattern).match(path)) included = !negated;
  }
  return included;
}

// biome の override は後勝ちで置換されるため、実効的な ban は「最後にマッチした override」の
// 内容で決まる。
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

// web 専用 ban が実効的に生きているかの判定本体。fixture でも実ファイルでも同じ関数を通すことで、
// edge test が「自作の期待値と自作の計算を突き合わせる」だけの tautology にならないようにする。
export function webOnlyBanViolations(config: BiomeConfig): string[] {
  const violations: string[] = [];
  const sorted = webOnlyGroups(config).map((group) => [...group].sort());

  // 0 / 1 / 3+ は loud fail にする (selector が空振りして invariant が silent に消えるのを防ぐ)。
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
  // 3 scope それぞれの代表 file に最後にマッチする override が web 専用 ban を持っていること。
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
  /** devDependencies にあるのに web 専用 ban に載っていない (= 誤って許可側へ逃げている) */
  missingFromBan: string[];
  /** 許可リストと ban の両方に載っている (分類が矛盾している) */
  bannedButAllowed: string[];
  /** どの devDependency にも当たらない ban entry (削除済み package の残骸) */
  staleBanPatterns: string[];
}

// "@radix-ui/*" 等の glob は Bun.Glob で実名展開して比較する (自前 matcher を書かない)。
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

// FROM 行の token 列。`--platform=...` 等の flag / 小文字 `as` / 行末コメントを許容する。
// 厳密な `^FROM \S+ AS \S+$` に絞ると、これらの正当な記法や名前なしの FROM が「FROM 行でない」
// 扱いになり、最終 stage 契約の検査が silent に空振りする。
function fromTokens(line: string): string[] | null {
  const match = /^\s*FROM\s+(.+)$/i.exec(line.replace(/#.*$/, ""));
  if (match === null) return null;
  const tokens = (match[1] as string)
    .trim()
    .split(/\s+/)
    .filter((token) => !token.startsWith("--"));
  return tokens.length === 0 ? null : tokens;
}

// `FROM <image> AS <name>` の name。FROM 行でない、または名前なし FROM なら null。
function fromStageName(line: string): string | null {
  const tokens = fromTokens(line);
  if (tokens === null) return null;
  const asIndex = tokens.findIndex((token) => token.toUpperCase() === "AS");
  return asIndex === -1 ? null : (tokens[asIndex + 1] ?? null);
}

// Dockerfile の stage 本文を切り出す (次の FROM 行までが 1 stage)。
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

// `./x` と `x/` を素の `x` に畳む (allowlist / 存在確認を表記ゆれで素通りさせないため)。
function normalizeCopyPath(token: string): string {
  return token.replace(/^\.\//, "").replace(/\/+$/, "");
}

// COPY 行を source 群と dest に分解する (`COPY --chown=bun:bun a b ./dest` の a / b が source)。
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

// manifests stage が COPY してよい source。denylist (packages / src / web の 3 名) だと
// `COPY . .` や新設 source dir が素通りするので allowlist で閉じる。
const MANIFEST_SOURCE = /^(package\.json|bun\.lock|packages\/[^/]+\/package\.json)$/;

export function dockerfileViolations(dockerfile: string, workspacePackages: string[]): string[] {
  const violations: string[] = [];

  // (a) install layer の入力を manifest だけに保つ。
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

    // (a') workspace package を足したら manifests stage に COPY 行を 1 行足す、という Dockerfile の
    //      コメント契約を機械化する (足し忘れが docker build まで顕在化せず、しかも誤誘導される
    //      理由: docs/adr/0014-docker-runner-dev-stage-separation.md の Decision 2)。
    for (const name of workspacePackages) {
      const manifestPath = `packages/${name}/package.json`;
      if (!copiedSources.includes(manifestPath)) {
        violations.push(
          `manifests stage に workspace package ${name} の manifest COPY が無い。次の 1 行を manifests stage に足す: COPY ${manifestPath} ./${manifestPath}`,
        );
      }
    }
  }

  // (b) COPY を install の上へ戻す regression は install layer 無効化を silent に復活させ、
  //     他の全 assert が緑のまま素通りする。
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

  // (c) 位置契約 (既定 build target = dev) の決定的な静的検証。CI の image ID 一致 assert は
  //     cache 前提の間接検証なので、こちらが主・あちらが defense-in-depth。
  //     名前なしの最終 FROM は「既定 target が dev でない」状態そのものなので違反として扱う。
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

// ADR-0009 §A: action は 40 桁 commit SHA で pin し、可読性のため version コメントを付ける。
// SHA は大文字 hex も同じ commit を指す。version コメントの後ろの補足 (`# v4.2.2 (pinned)` 等) は
// 可読性のためのものなので許す — ここを厳しくしても供給元は変わらず、偽陽性で pin 検査全体の
// 信頼を落とすだけ。
const PINNED_USES = /^\s*-?\s*uses:\s*\S+@[0-9a-fA-F]{40}\s+#\s*v\S+(\s.*)?$/;

// ローカル composite action (`uses: ./.github/actions/...`) は repo 内のコードで、supply chain の
// 供給元が外部にない。pin できる SHA も存在しないため対象外にする。
const LOCAL_USES = /^\s*-?\s*uses:\s*\.{1,2}\//;

// 検査対象行の抽出は pin 判定と件数 guard の共通 selector。片方だけ条件を直すと「対象 0 行で緑」を
// 検出するための guard が別集合を数えることになるため 1 箇所に閉じる (対象外の local action も
// ここで落とす)。
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

// 対象一覧は列挙でなく実ディレクトリから導出する。新規 workflow / 新規 workspace package を足した
// 瞬間に invariant の対象へ入る (列挙だと足し忘れた新規ファイルが検査されないまま緑になる)。
export function workflowFileNames(): string[] {
  return readdirSync(join(REPO_ROOT, ".github/workflows")).filter((name) => /\.ya?ml$/.test(name));
}

export function workspacePackageNames(): string[] {
  const packagesDir = join(REPO_ROOT, "packages");
  return readdirSync(packagesDir).filter((name) =>
    existsSync(join(packagesDir, name, "package.json")),
  );
}
