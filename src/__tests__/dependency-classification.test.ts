// biome の web 専用 ban / connect-node ban と package.json の依存 section が食い違っていないかを
// 見る config invariant。分類規約そのものの正本: docs/adr/0014-docker-runner-dev-stage-separation.md

import { describe, expect, test } from "bun:test";
import {
  type BiomeConfig,
  type BiomeOverride,
  CONNECT_NODE,
  classificationDiff,
  classificationViolations,
  effectiveOverride,
  effectiveWebOnlyGroup,
  EXPECTED_CONNECT_NODE_COPY_COUNT,
  EXPECTED_WEB_ONLY_COPY_COUNT,
  hasConnectNodeBan,
  overrideMatches,
  parseJsonc,
  readBiomeConfig,
  readPackageJson,
  REPRESENTATIVE_DB_FILE,
  REPRESENTATIVE_MANAGEMENT_FILE,
  REPRESENTATIVE_SERVER_FILE,
  type RestrictedPattern,
  restrictedPatterns,
  WEB_ONLY_DEP_MESSAGE,
  webOnlyBanViolations,
  webOnlyGroups,
} from "./config-invariant-helpers";

// devDependencies のうち web 専用 ban の対象外にするもの。
// 判定基準は「server コードから import され得る runtime module か (誤って import したら runner で
// 落ちる種類か)」。CLI / build 設定 / 型定義 / test 専用 runtime は許可、それ以外は ban 側。
// 「ship される server コードが import しない」という基準にすると全 devDependencies が該当して
// 分類にならないため採らない。許可側へ誤って逃がした package は runner image の bun build probe
// (scripts/docker-smoke.sh) が behavioral に捕まえる。
const ALLOWED_DEV_DEPENDENCIES: Record<string, string> = {
  "@biomejs/biome": "build-tool: lint / format CLI。server コードから import しない",
  "@bufbuild/buf": "build-tool: proto codegen CLI (host 実行)",
  "@bufbuild/protoc-gen-es": "build-tool: buf generate の plugin (生成物のみ ship する)",
  "@tailwindcss/forms": "build-tool: tailwind.config.ts が読む PostCSS 時の plugin",
  "@vitejs/plugin-react": "build-tool: web/vite.config.ts が読む build plugin",
  autoprefixer: "build-tool: postcss.config.js が読む build 時 plugin",
  "drizzle-kit": "build-tool: migration 生成 / 適用 CLI (dev image と auth-migrate が実行)",
  postcss: "build-tool: web の CSS build pipeline",
  tailwindcss: "build-tool: web の CSS build pipeline",
  typescript: "build-tool: tsc (typecheck と auth-client の dist build)",
  vite: "build-tool: 共通画面 SPA の bundler",
  wrangler: "build-tool: Cloudflare Workers の deploy / dev CLI",
  "@types/bun": "type-only: 型定義のみ (runtime 実体なし)",
  "@types/node": "type-only: 型定義のみ (runtime 実体なし)",
  "@types/pg": "type-only: 型定義のみ (runtime 実体なし)",
  "@types/qrcode": "type-only: 型定義のみ (runtime 実体なし)",
  "@types/react": "type-only: 型定義のみ (runtime 実体なし)",
  "@types/react-dom": "type-only: 型定義のみ (runtime 実体なし)",
  "@better-auth/utils":
    "test-only-runtime: src/mfa/__tests__/helpers.ts と e2e から runtime import するが ship される server コードからは import しない",
  "@playwright/test":
    "test-only-runtime: e2e runner。ship される server コードからは import しない",
};

describe("依存分類 (biome ban ↔ package.json) の config invariant", () => {
  test("QA-I-01: web 専用 ban は 2 copy あり group 集合が一致する", () => {
    expect(webOnlyBanViolations(readBiomeConfig())).toEqual([]);
  });

  test("QA-I-02: devDependencies − 許可リスト == web 専用 group (両方向)", () => {
    const config = readBiomeConfig();
    const pkg = readPackageJson();
    const devDeps = Object.keys(pkg.devDependencies ?? {});
    const group = webOnlyGroups(config)[0] as string[];

    expect(
      classificationViolations(classificationDiff(devDeps, ALLOWED_DEV_DEPENDENCIES, group)),
    ).toEqual([]);

    // 許可リストの各エントリは 3 分類 (build-tool / type-only / test-only-runtime) の理由を持つ。
    const reasonless = Object.entries(ALLOWED_DEV_DEPENDENCIES)
      .filter(([, reason]) => !/^(build-tool|type-only|test-only-runtime):/.test(reason))
      .map(([name]) => name);
    expect(reasonless).toEqual([]);

    // 許可リストに載っているのに devDependencies から消えた package (stale entry) も検出する。
    expect(Object.keys(ALLOWED_DEV_DEPENDENCIES).filter((name) => !devDeps.includes(name))).toEqual(
      [],
    );
  });

  test("QA-M-06: @connectrpc/connect-node は依存から不在かつ 2 copy で ban 済み", () => {
    const config = readBiomeConfig();
    const pkg = readPackageJson();

    expect(Object.keys(pkg.dependencies ?? {}).includes(CONNECT_NODE)).toBe(false);
    expect(Object.keys(pkg.devDependencies ?? {}).includes(CONNECT_NODE)).toBe(false);

    // web 専用 group とは別 pattern entry (message が違う) なので別 assert にする。
    const bans = (config.overrides ?? []).filter(hasConnectNodeBan);
    expect(bans.length).toBe(EXPECTED_CONNECT_NODE_COPY_COUNT);

    // copy 数だけだと、ban を src にマッチしない override へ移しても 2 件のまま緑になる。
    // 実効的にどの override が効くかは「最後にマッチした override」で決まるのでそちらを見る。
    const effective = effectiveOverride(config, REPRESENTATIVE_SERVER_FILE);
    expect(effective).not.toBeNull();
    expect(hasConnectNodeBan(effective as BiomeOverride)).toBe(true);
  });

  test("QA-E-02: 片方の override だけに追記すると group 集合の不一致で落ちる", () => {
    const config = readBiomeConfig();
    // 呼ぶたびに parse し直すため patched への破壊的変更は config 側に漏れない。
    const patched = readBiomeConfig();
    const firstGroup = webOnlyGroups(patched)[0] as string[];
    firstGroup.push("react-day-picker");

    const groups = webOnlyGroups(patched).map((group) => [...group].sort());
    expect(groups.length).toBe(EXPECTED_WEB_ONLY_COPY_COUNT);
    expect(groups[0]).not.toEqual(groups[1] as string[]);

    // 元の config は一致したまま (fixture 改変が実ファイルに漏れていないことの確認)。
    const original = webOnlyGroups(config).map((group) => [...group].sort());
    expect(original[0]).toEqual(original[1] as string[]);
  });

  test("QA-M-11: web 専用 devDependency を足して ban 未追記だと差分が列挙される", () => {
    const config = readBiomeConfig();
    const pkg = readPackageJson();
    const devDeps = [...Object.keys(pkg.devDependencies ?? {}), "react-day-picker"];
    const group = webOnlyGroups(config)[0] as string[];

    const diff = classificationDiff(devDeps, ALLOWED_DEV_DEPENDENCIES, group);
    expect(diff.missingFromBan).toEqual(["react-day-picker"]);

    const violations = classificationViolations(diff);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("react-day-picker");
    expect(violations[0]).toContain("biome.json の 2 つの override group");
    expect(violations[0]).toContain("ALLOWED_DEV_DEPENDENCIES");
  });

  test("QA-M-15: selector の出現回数 0 / 1 / 3 と後置 override は loud fail する", () => {
    const withCopies = (count: number): BiomeConfig => ({
      overrides: Array.from({ length: count }, () => ({
        includes: ["src/**", "db/**", "management/**"],
        linter: {
          rules: {
            style: {
              noRestrictedImports: {
                options: { patterns: [{ group: ["lucide-react"], message: WEB_ONLY_DEP_MESSAGE }] },
              },
            },
          },
        },
      })),
    });

    // fixture の copy 数を数え直すのではなく、実ファイルにかけている検査関数へ通す
    // (「2 でなければ violation」を production 側が本当に持っていることの確認)。
    for (const count of [0, 1, 3]) {
      expect(webOnlyBanViolations(withCopies(count)).join("\n")).toContain(
        `web 専用 ban の copy 数が ${count} 個`,
      );
    }
    expect(webOnlyBanViolations(withCopies(EXPECTED_WEB_ONLY_COPY_COUNT))).toEqual([]);

    // message 文言がズレた fixture では selector が空振りする (named 定数を直す必要がある証拠)。
    const renamed = withCopies(EXPECTED_WEB_ONLY_COPY_COUNT);
    for (const override of renamed.overrides ?? []) {
      const patterns = restrictedPatterns(override);
      (patterns[0] as RestrictedPattern).message = `${WEB_ONLY_DEP_MESSAGE} (改稿)`;
    }
    expect(webOnlyGroups(renamed).length).toBe(0);

    // 代表 file にマッチする override を後ろに足すと、2 copy は残るのに実効 ban が消える。
    // 出現回数 assert は素通りし、実効内容 assert だけが落ちること。3 scope それぞれで確認する。
    for (const [scope, path] of [
      ["src/**", REPRESENTATIVE_SERVER_FILE],
      ["db/**", REPRESENTATIVE_DB_FILE],
      ["management/**", REPRESENTATIVE_MANAGEMENT_FILE],
    ] as const) {
      const shadowed = withCopies(EXPECTED_WEB_ONLY_COPY_COUNT);
      (shadowed.overrides ?? []).push({
        includes: [scope],
        linter: { rules: { style: { noRestrictedImports: { options: { patterns: [] } } } } },
      });
      expect(webOnlyGroups(shadowed).length).toBe(EXPECTED_WEB_ONLY_COPY_COUNT);
      expect(effectiveWebOnlyGroup(shadowed, path)).toBeNull();
      expect(webOnlyBanViolations(shadowed).join("\n")).toContain(path);
    }
  });

  // biome 2.4.14 実測: `includes` は順に評価して最後にマッチした pattern が勝つ。
  // ここを取り違えると、実 config の override[1] (`["src/**", "!src/**/__tests__/**", "!src/auth.ts"]`)
  // に対する「最後にマッチする override」の判定がズレて、実効 ban の検査が別 override を見る。
  test("overrideMatches は includes の後勝ち semantics に従う", () => {
    const matches = (includes: string[], path: string) => overrideMatches({ includes }, path);

    expect(matches(["!src/handlers/**", "src/**"], "src/handlers/account-company.ts")).toBe(true);
    expect(matches(["!src/auth.ts", "src/**"], "src/auth.ts")).toBe(true);
    expect(matches(["src/**", "!src/auth.ts"], "src/auth.ts")).toBe(false);
    // どの pattern にもマッチしなければ対象外。
    expect(matches(["db/**"], "src/auth.ts")).toBe(false);
    expect(matches([], "src/auth.ts")).toBe(false);
  });

  test("parseJsonc は行コメント / ブロックコメント / 末尾カンマを許容する", () => {
    const jsonc = `{
      // 行コメント (URL http://example.com も壊さない)
      "overrides": [
        /* ブロックコメント */
        { "includes": ["src/**"] },
      ],
    }`;
    expect(parseJsonc(jsonc).overrides?.length).toBe(1);
    // 文字列中の // はコメントとして削らない
    expect(
      parseJsonc('{ "overrides": [{ "includes": ["https://x//y"] }] }').overrides?.[0],
    ).toEqual({
      includes: ["https://x//y"],
    });
  });
});
