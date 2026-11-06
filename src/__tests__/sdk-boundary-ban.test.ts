import { describe, expect, test } from "bun:test";
import {
  type OxlintOverride,
  readOxlintConfig,
  restrictedImports,
  webOnlyGroupOf,
} from "./config-invariant-helpers";

const SDK_BANNED_PATHS = [
  "@connectrpc/connect-node",
  "@connectrpc/connect-web",
  "drizzle-orm",
  "next",
  "next/cache",
  "next/headers",
  "next/navigation",
  "next/server",
  "pg",
  "react",
  "react-dom",
];

describe("SDK 境界 (packages/auth-client) の ban 集合 invariant", () => {
  test("SDK 境界 override (packages/auth-client/**) は selector の対象外で ban path 集合が保たれる", () => {
    const config = readOxlintConfig();
    const sdkOverride = (config.overrides ?? []).find((override) =>
      override.files.includes("packages/auth-client/**"),
    );
    expect(sdkOverride).toBeDefined();

    const paths = (restrictedImports(sdkOverride as OxlintOverride)?.paths ?? []).map(
      ({ name }) => name,
    );
    expect([...paths].sort()).toEqual(SDK_BANNED_PATHS);
    expect(webOnlyGroupOf(sdkOverride as OxlintOverride)).toBeNull();
  });
});
