import { describe, expect, test } from "bun:test";
import { type BiomeOverride, readBiomeConfig, webOnlyGroupOf } from "./config-invariant-helpers";

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
