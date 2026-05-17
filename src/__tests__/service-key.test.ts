import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getValidServiceKeys } from "../service-key";

describe("getValidServiceKeys", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AUTH_SERVICE_KEY;
    delete process.env.AUTH_SERVICE_KEY_PREVIOUS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("active のみ set → active 1 個", () => {
    process.env.AUTH_SERVICE_KEY = "active-key";
    expect(getValidServiceKeys()).toEqual(["active-key"]);
  });

  test("active + previous 両方 set → 2 個", () => {
    process.env.AUTH_SERVICE_KEY = "active-key";
    process.env.AUTH_SERVICE_KEY_PREVIOUS = "previous-key";
    expect(getValidServiceKeys()).toEqual(["active-key", "previous-key"]);
  });

  test("previous のみ set → previous 1 個 (運用上想定外だが safe)", () => {
    process.env.AUTH_SERVICE_KEY_PREVIOUS = "previous-key";
    expect(getValidServiceKeys()).toEqual(["previous-key"]);
  });

  test("両方 unset → 空配列", () => {
    expect(getValidServiceKeys()).toEqual([]);
  });
});
