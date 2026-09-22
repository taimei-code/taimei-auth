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

// 許可基準は「server コードから import され得る runtime module か」(「ship される server コードが import しない」だと全 devDependencies が該当する)。
const ALLOWED_DEV_DEPENDENCIES: Record<string, string> = {
  "@biomejs/biome": "build-tool: lint / format CLI。server コードから import しない",
  "@bufbuild/buf": "build-tool: proto codegen CLI (host 実行)",
  "@bufbuild/protoc-gen-es": "build-tool: buf generate の plugin (生成物のみ ship する)",
  "@tailwindcss/forms": "build-tool: tailwind.config.ts が読む PostCSS 時の plugin",
  "@vitejs/plugin-react": "build-tool: web/vite.config.ts が読む build plugin",
  autoprefixer: "build-tool: postcss.config.js が読む build 時 plugin",
  "drizzle-kit": "build-tool: migration 生成 / 適用 CLI (dev image と auth-migrate が実行)",
  fallow: "build-tool: dead code / 循環依存の静的解析 CLI (CI の fallow audit と MCP server)",
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

    const reasonless = Object.entries(ALLOWED_DEV_DEPENDENCIES)
      .filter(([, reason]) => !/^(build-tool|type-only|test-only-runtime):/.test(reason))
      .map(([name]) => name);
    expect(reasonless).toEqual([]);

    expect(Object.keys(ALLOWED_DEV_DEPENDENCIES).filter((name) => !devDeps.includes(name))).toEqual(
      [],
    );
  });

  test("QA-M-06: @connectrpc/connect-node は依存から不在かつ 2 copy で ban 済み", () => {
    const config = readBiomeConfig();
    const pkg = readPackageJson();

    expect(Object.keys(pkg.dependencies ?? {}).includes(CONNECT_NODE)).toBe(false);
    expect(Object.keys(pkg.devDependencies ?? {}).includes(CONNECT_NODE)).toBe(false);

    const bans = (config.overrides ?? []).filter(hasConnectNodeBan);
    expect(bans.length).toBe(EXPECTED_CONNECT_NODE_COPY_COUNT);

    const effective = effectiveOverride(config, REPRESENTATIVE_SERVER_FILE);
    expect(effective).not.toBeNull();
    expect(hasConnectNodeBan(effective as BiomeOverride)).toBe(true);
  });

  test("QA-E-02: 片方の override だけに追記すると group 集合の不一致で落ちる", () => {
    const config = readBiomeConfig();
    // readBiomeConfig は呼ぶたびに parse し直すので、patched への破壊的変更は config に影響しない。
    const patched = readBiomeConfig();
    const firstGroup = webOnlyGroups(patched)[0] as string[];
    firstGroup.push("react-day-picker");

    const groups = webOnlyGroups(patched).map((group) => [...group].sort());
    expect(groups.length).toBe(EXPECTED_WEB_ONLY_COPY_COUNT);
    expect(groups[0]).not.toEqual(groups[1] as string[]);

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

    for (const count of [0, 1, 3]) {
      expect(webOnlyBanViolations(withCopies(count)).join("\n")).toContain(
        `web 専用 ban の copy 数が ${count} 個`,
      );
    }
    expect(webOnlyBanViolations(withCopies(EXPECTED_WEB_ONLY_COPY_COUNT))).toEqual([]);

    const renamed = withCopies(EXPECTED_WEB_ONLY_COPY_COUNT);
    for (const override of renamed.overrides ?? []) {
      const patterns = restrictedPatterns(override);
      (patterns[0] as RestrictedPattern).message = `${WEB_ONLY_DEP_MESSAGE} (改稿)`;
    }
    expect(webOnlyGroups(renamed).length).toBe(0);

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

  test("overrideMatches は includes の後勝ち semantics に従う", () => {
    const matches = (includes: string[], path: string) => overrideMatches({ includes }, path);

    expect(matches(["!src/handlers/**", "src/**"], "src/handlers/account-company.ts")).toBe(true);
    expect(matches(["!src/auth.ts", "src/**"], "src/auth.ts")).toBe(true);
    expect(matches(["src/**", "!src/auth.ts"], "src/auth.ts")).toBe(false);
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
    expect(
      parseJsonc('{ "overrides": [{ "includes": ["https://x//y"] }] }').overrides?.[0],
    ).toEqual({
      includes: ["https://x//y"],
    });
  });
});
