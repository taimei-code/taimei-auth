import { describe, expect, test } from "bun:test";
import { auth } from "../../auth";
import { RAW_TWO_FACTOR_PATHS } from "../blocked-paths";

type PluginEndpoint = { path?: string; options?: { metadata?: { SERVER_ONLY?: boolean } } };
type RegisteredPlugin = { id: string; endpoints?: Record<string, PluginEndpoint> };

function twoFactorPluginEndpoints(): Record<string, PluginEndpoint> {
  const plugins = (auth.options.plugins ?? []) as unknown as RegisteredPlugin[];
  const twoFactorPlugin = plugins.find((plugin) => plugin.id === "two-factor");
  if (!twoFactorPlugin) throw new Error("two-factor plugin is not registered");
  return twoFactorPlugin.endpoints ?? {};
}

describe("RAW_TWO_FACTOR_PATHS (遮断カタログ)", () => {
  test("QA-M-11 プラグインの path を持つ endpoint と過不足なく一致する", () => {
    const registeredPaths = Object.values(twoFactorPluginEndpoints())
      .map((endpoint) => endpoint.path)
      .filter((path): path is string => typeof path === "string");

    const blockedPaths: string[] = [...RAW_TWO_FACTOR_PATHS];
    expect(blockedPaths.sort()).toEqual(registeredPaths.sort());
  });

  test("QA-M-11 path を持たない endpoint は serverOnly だけで HTTP router に載らない", () => {
    const pathless = Object.entries(twoFactorPluginEndpoints()).filter(
      ([, endpoint]) => typeof endpoint.path !== "string",
    );

    expect(pathless.map(([name]) => name).sort()).toEqual(["generateTOTP", "viewBackupCodes"]);
    for (const [name, endpoint] of pathless) {
      expect({ name, serverOnly: endpoint.options?.metadata?.SERVER_ONLY }).toEqual({
        name,
        serverOnly: true,
      });
    }
  });

  test("QA-M-11 カタログは 8 件で重複が無く全て /two-factor/ 配下", () => {
    expect(RAW_TWO_FACTOR_PATHS).toHaveLength(8);
    expect(new Set(RAW_TWO_FACTOR_PATHS).size).toBe(8);
    for (const path of RAW_TWO_FACTOR_PATHS) {
      expect({ path, underTwoFactor: path.startsWith("/two-factor/") }).toEqual({
        path,
        underTwoFactor: true,
      });
    }
  });

  test("QA-M-11 チャレンジ通過に使う verify 系 3 route も遮断対象に含む", () => {
    expect([...RAW_TWO_FACTOR_PATHS]).toEqual(
      expect.arrayContaining([
        "/two-factor/verify-totp",
        "/two-factor/verify-otp",
        "/two-factor/verify-backup-code",
      ]),
    );
  });
});
