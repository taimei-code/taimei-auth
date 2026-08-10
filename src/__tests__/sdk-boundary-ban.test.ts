// biome の SDK 境界 override (packages/auth-client/**) が ban する consumer framework 集合の
// config invariant。方針の正本: packages/auth-client/CLAUDE.md ルール 7

import { describe, expect, test } from "bun:test";
import { type BiomeOverride, readBiomeConfig, webOnlyGroupOf } from "./config-invariant-helpers";

// SDK 境界 override (packages/auth-client/**) が ban する consumer framework の path。
// 件数でなく集合で比較する (件数一致のまま中身が入れ替わる drift を検出する)。
// SDK を consumer framework に依存させない方針の正本: packages/auth-client/CLAUDE.md (経緯: PR #41)
const SDK_BANNED_PATHS = [
  "@connectrpc/connect-node",
  "@connectrpc/connect-web",
  "next",
  "next/cache",
  "next/headers",
  "next/navigation",
  "next/server",
  "react",
  "react-dom",
];

describe("SDK 境界 (packages/auth-client) の ban 集合 invariant", () => {
  test("QA-R-08: SDK 境界 override (packages/auth-client/**) は selector の対象外で ban path 集合が保たれる", () => {
    const config = readBiomeConfig();
    const sdkOverride = (config.overrides ?? []).find((override) =>
      (override.includes ?? []).includes("packages/auth-client/**"),
    );
    expect(sdkOverride).toBeDefined();

    const paths = Object.keys(
      (sdkOverride as BiomeOverride).linter?.rules?.style?.noRestrictedImports?.options?.paths ??
        {},
    );
    expect([...paths].sort()).toEqual(SDK_BANNED_PATHS);
    expect(webOnlyGroupOf(sdkOverride as BiomeOverride)).toBeNull();
  });
});
