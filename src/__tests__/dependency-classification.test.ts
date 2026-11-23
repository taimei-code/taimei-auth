import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_ONLY_DEPENDENCIES } from "../../lint/oxlint-plugin.mjs";
import {
  classificationDiff,
  classificationViolations,
  parseJsonc,
  readOxlintConfig,
  readPackageJson,
  REPO_ROOT,
  workspacePackageNames,
} from "./config-invariant-helpers";
import { repoFiles } from "./source-scan";

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
  "@foldkit/vite-plugin": "build-tool: web/vite.config.ts が読む Foldkit の build plugin",
  "@tailwindcss/forms": "build-tool: tailwind.config.ts が読む PostCSS 時の plugin",
  alchemy: "build-tool: infra/alchemy.run.ts が宣言する IaC の CLI (staging の deploy)",
  autoprefixer: "build-tool: postcss.config.js が読む build 時 plugin",
  "drizzle-kit": "build-tool: migration 生成 CLI (host の bun run db:generate)",
  oxlint: "build-tool: lint CLI。server コードから import しない",
  "oxlint-tsgolint":
    "build-tool: oxlint の --type-aware が呼ぶ型の検査の CLI。server コードから import しない",
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
  "@better-auth/utils":
    "test-only-runtime: src/mfa/__tests__/helpers.ts と e2e から runtime import するが ship される server コードからは import しない",
  "@playwright/test":
    "test-only-runtime: e2e runner。ship される server コードからは import しない",
};

describe("依存分類 (oxlint の ban ↔ package.json) の config invariant", () => {
  test("devDependencies − 許可リスト == web 専用 group (両方向)", () => {
    const pkg = readPackageJson();
    const devDeps = Object.keys(pkg.devDependencies ?? {});
    const group = [...WEB_ONLY_DEPENDENCIES];

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

  test("web 専用 devDependency を足して ban 未追記だと差分が列挙される", () => {
    const pkg = readPackageJson();
    const devDeps = [...Object.keys(pkg.devDependencies ?? {}), "react-day-picker"];
    const group = [...WEB_ONLY_DEPENDENCIES];

    const diff = classificationDiff(devDeps, ALLOWED_DEV_DEPENDENCIES, group);
    expect(diff.missingFromBan).toEqual(["react-day-picker"]);

    const violations = classificationViolations(diff);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("react-day-picker");
    expect(violations[0]).toContain("WEB_ONLY_DEPENDENCIES");
    expect(violations[0]).toContain("ALLOWED_DEV_DEPENDENCIES");
  });

  test("@connectrpc/connect-node は dependencies にも devDependencies にも無い (import の禁止は lint の表の行が持つ)", () => {
    const { dependencies, devDependencies } = readPackageJson();
    expect(Object.keys({ ...dependencies, ...devDependencies })).not.toContain(
      "@connectrpc/connect-node",
    );
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

describe("WebAuthn の検証の library の固定", () => {
  const PACKAGE = "@simplewebauthn/server";
  const VERSION = "14.1.0";

  test(`${PACKAGE} が ${VERSION} に固定して dependencies に足され、bun.lock がその版を解決している`, () => {
    expect(readPackageJson().dependencies?.[PACKAGE]).toBe(VERSION);
    expect(readFileSync(join(REPO_ROOT, "bun.lock"), "utf8")).toContain(`"${PACKAGE}@${VERSION}"`);
  });
});

describe("repo は React に依存しない", () => {
  const REACT_DEPENDENCY = /"(react|react-dom|@types\/react|@react-email\/[^"]+)"\s*:/;
  const SOURCE_DIRS = ["src", "web", "testing", "e2e", "packages"];

  test("package.json に react・react-dom・@types/react・@react-email の依存が無い", () => {
    const manifests = [
      "package.json",
      ...workspacePackageNames().map((name) => `packages/${name}/package.json`),
    ];
    expect(
      manifests.filter((path) =>
        REACT_DEPENDENCY.test(readFileSync(join(REPO_ROOT, path), "utf8")),
      ),
    ).toEqual([]);
  });

  test("source に JSX を書く .tsx の file が無い", () => {
    expect(repoFiles(...SOURCE_DIRS.map((dir) => `:(glob)${dir}/**/*.tsx`))).toEqual([]);
  });

  test("起動時に初期化される prismjs が lockfile に無い", () => {
    expect(readFileSync(join(REPO_ROOT, "bun.lock"), "utf8")).not.toContain('"prismjs@');
  });
});
