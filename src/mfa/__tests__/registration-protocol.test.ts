import { describe, expect, test } from "bun:test";
import { assertRegistrationGuardProtocolVersion } from "../registration/management";

describe("MFA registration guard protocol", () => {
  test.each([
    [undefined, "missing"],
    [2, "2"],
  ] as const)("rejects unsupported database version %s", (version, displayedVersion) => {
    expect(() => assertRegistrationGuardProtocolVersion(version)).toThrow(
      `MFA registration guard protocol mismatch: expected 1, got ${displayedVersion}`,
    );
  });

  test("accepts database version 1", () => {
    expect(() => assertRegistrationGuardProtocolVersion(1)).not.toThrow();
  });
});
