import { expect, test } from "bun:test";
import { PASSKEY_PROVIDERS } from "../passkey-providers";

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALL_ZERO = "00000000-0000-0000-0000-000000000000";

test("提供元の表の aaguid は、library が保存する小文字の hyphen 付き UUID の形で、重複が無く、全 0 を含まない", () => {
  const aaguids = PASSKEY_PROVIDERS.map(({ aaguid }) => aaguid);

  expect(aaguids.filter((aaguid) => !LOWERCASE_UUID.test(aaguid))).toEqual([]);
  expect(new Set(aaguids).size).toBe(aaguids.length);
  expect(aaguids).not.toContain(ALL_ZERO);
});
