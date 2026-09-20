import { describe, expect, test } from "bun:test";
import { toRateWindowResult } from "../redis";

// incrementWindow の応答 (number) → RateWindowResult の純関数。
describe("toRateWindowResult", () => {
  const contractError = /^incrementRateWindow:/;

  test("正常応答は count を返す", () => {
    expect(toRateWindowResult(3)).toEqual({ count: 3 });
  });

  test("count 1 (下限) は通す", () => {
    expect(toRateWindowResult(1).count).toBe(1);
  });

  test("count 0 は契約逸脱として throw する", () => {
    expect(() => toRateWindowResult(0)).toThrow(contractError);
  });

  test("NaN は throw する (0 に潰して fail-open にしない)", () => {
    expect(() => toRateWindowResult(Number.NaN)).toThrow(contractError);
  });
});
