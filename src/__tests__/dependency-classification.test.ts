import { describe, expect, test } from "bun:test";
import {
  CONNECT_NODE,
  classificationDiff,
  classificationViolations,
  effectiveOverride,
  effectiveWebOnlyGroup,
  EXPECTED_CONNECT_NODE_COPY_COUNT,
  EXPECTED_WEB_ONLY_COPY_COUNT,
  hasConnectNodeBan,
  type OxlintConfig,
  type OxlintOverride,
  overrideMatches,
  parseJsonc,
  readOxlintConfig,
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

const ALLOWED_DEV_DEPENDENCIES: Record<string, string> = {
  "@alchemy.run/cloudflare":
    "build-tool: infra/alchemy.run.ts が import する alchemy の Cloudflare の資源",
  "@biomejs/biome": "build-tool: format CLI。server コードから import しない",
  "@bufbuild/buf": "build-tool: proto codegen CLI (host 実行)",
  "@bufbuild/protoc-gen-es": "build-tool: buf generate の plugin (生成物のみ ship する)",
  "@effect/platform-bun":
    "build-tool: bunx alchemy が起動時に読む peer 依存 (Bun の入口では platform-node でなくこちらを読む)",
  "@effect/platform-node":
    "build-tool: @alchemy.run/cloudflare の Worker の資源が静的に import する peer 依存 (optional と書かれているが、無いと定義を読めない)",
  "@effect/tsgo": "build-tool: Effect の診断入りの tsc (bun run typecheck)",
  "@foldkit/oxlint-plugin": "build-tool: oxlint が読む Foldkit の lint の plugin",
  "@foldkit/vite-plugin": "build-tool: web の vite の設定が読む Foldkit の build plugin",
  "@tailwindcss/forms": "build-tool: tailwind.config.ts が読む PostCSS 時の plugin",
  "@vitejs/plugin-react": "build-tool: web/vite.config.ts が読む build plugin",
  alchemy: "build-tool: infra/alchemy.run.ts が宣言する IaC の CLI (staging の deploy)",
  autoprefixer: "build-tool: postcss.config.js が読む build 時 plugin",
  "drizzle-kit": "build-tool: migration 生成 CLI (host の bun run db:generate)",
  oxlint: "build-tool: lint CLI。server コードから import しない",
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

describe("依存分類 (oxlint の ban ↔ package.json) の config invariant", () => {
  test("web 専用 ban の全 copy で group 集合が一致する", () => {
    expect(webOnlyBanViolations(readOxlintConfig())).toEqual([]);
  });

  test("devDependencies − 許可リスト == web 専用 group (両方向)", () => {
    const config = readOxlintConfig();
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

  test("@connectrpc/connect-node は依存から不在かつ全 copy で ban 済み", () => {
    const config = readOxlintConfig();
    const pkg = readPackageJson();

    expect(Object.keys(pkg.dependencies ?? {}).includes(CONNECT_NODE)).toBe(false);
    expect(Object.keys(pkg.devDependencies ?? {}).includes(CONNECT_NODE)).toBe(false);

    const bans = (config.overrides ?? []).filter(hasConnectNodeBan);
    expect(bans.length).toBe(EXPECTED_CONNECT_NODE_COPY_COUNT);

    const effective = effectiveOverride(config, REPRESENTATIVE_SERVER_FILE);
    expect(effective).not.toBeNull();
    expect(hasConnectNodeBan(effective as OxlintOverride)).toBe(true);
  });

  test("片方の override だけに追記すると group 集合の不一致で落ちる", () => {
    const config = readOxlintConfig();
    const patched = readOxlintConfig();
    const firstGroup = webOnlyGroups(patched)[0] as string[];
    firstGroup.push("react-day-picker");

    const groups = webOnlyGroups(patched).map((group) => [...group].sort());
    expect(groups.length).toBe(EXPECTED_WEB_ONLY_COPY_COUNT);
    expect(groups[0]).not.toEqual(groups[1] as string[]);

    const original = webOnlyGroups(config).map((group) => [...group].sort());
    expect(original[0]).toEqual(original[1] as string[]);
  });

  test("web 専用 devDependency を足して ban 未追記だと差分が列挙される", () => {
    const config = readOxlintConfig();
    const pkg = readPackageJson();
    const devDeps = [...Object.keys(pkg.devDependencies ?? {}), "react-day-picker"];
    const group = webOnlyGroups(config)[0] as string[];

    const diff = classificationDiff(devDeps, ALLOWED_DEV_DEPENDENCIES, group);
    expect(diff.missingFromBan).toEqual(["react-day-picker"]);

    const violations = classificationViolations(diff);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("react-day-picker");
    expect(violations[0]).toContain(".oxlintrc.json の override の group");
    expect(violations[0]).toContain("ALLOWED_DEV_DEPENDENCIES");
  });

  test("selector の出現回数 0 / 1 / 3 と後置 override は loud fail する", () => {
    const withCopies = (count: number): OxlintConfig => ({
      overrides: Array.from({ length: count }, () => ({
        files: ["src/**", "db/**", "management/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            { patterns: [{ group: ["lucide-react"], message: WEB_ONLY_DEP_MESSAGE }] },
          ],
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
        files: [scope],
        rules: { "no-restricted-imports": ["error", { patterns: [] }] },
      });
      expect(webOnlyGroups(shadowed).length).toBe(EXPECTED_WEB_ONLY_COPY_COUNT);
      expect(effectiveWebOnlyGroup(shadowed, path)).toBeNull();
      expect(webOnlyBanViolations(shadowed).join("\n")).toContain(path);
    }
  });

  test("overrideMatches は files のどれかに当たり excludeFiles のどれにも当たらない path を対象にする", () => {
    const matches = (files: string[], excludeFiles: string[], path: string) =>
      overrideMatches({ files, excludeFiles }, path);

    expect(matches(["src/**"], [], "src/handlers/account-company.ts")).toBe(true);
    expect(matches(["src/**"], ["src/auth.ts"], "src/auth.ts")).toBe(false);
    expect(matches(["src/**", "db/**"], ["src/auth.ts"], "db/schema.ts")).toBe(true);
    expect(matches(["db/**"], [], "src/auth.ts")).toBe(false);
    expect(matches([], [], "src/auth.ts")).toBe(false);
  });

  test("oxlint は files の否定の glob を黙って無視するので、override の files に ! で始まる glob を書かない (除外は excludeFiles に書く)", () => {
    const files = (readOxlintConfig().overrides ?? []).flatMap((override) => override.files);
    expect(files.filter((pattern) => pattern.startsWith("!"))).toEqual([]);
  });

  test("parseJsonc は行コメント / ブロックコメント / 末尾カンマを許容する", () => {
    const jsonc = `{
      // 行コメント (URL http://example.com も壊さない)
      "overrides": [
        /* ブロックコメント */
        { "includes": ["src/**"] },
      ],
    }`;
    expect(parseJsonc(jsonc)).toEqual({ overrides: [{ includes: ["src/**"] }] });
    expect(parseJsonc('{ "overrides": [{ "includes": ["https://x//y"] }] }')).toEqual({
      overrides: [{ includes: ["https://x//y"] }],
    });
  });
});
