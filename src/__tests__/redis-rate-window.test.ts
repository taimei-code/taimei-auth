import { describe, expect, test } from "bun:test";
import { toRateWindowResult } from "../redis";

// incrementWindow の応答 → RateWindowResult の純関数 (設計 AC-001〜AC-008)。
describe("toRateWindowResult", () => {
  const contractError = /^incrementRateWindow:/;

  test("AC-001 正常応答は count を返す", () => {
    expect(toRateWindowResult(3)).toEqual({ count: 3 });
  });

  test("AC-002 count は文字列でも数値に強制変換する", () => {
    expect(toRateWindowResult("5").count).toBe(5);
  });

  test("AC-003 count 1 (下限) は通す", () => {
    expect(toRateWindowResult(1).count).toBe(1);
  });

  test("AC-004 count 0 は契約逸脱として throw する", () => {
    expect(() => toRateWindowResult(0)).toThrow(contractError);
  });

  test("AC-005 count が NaN になる値は throw する", () => {
    expect(() => toRateWindowResult("abc")).toThrow(contractError);
  });

  test("AC-006 count が boolean なら強制変換せず throw する (true を 1 にしない)", () => {
    expect(() => toRateWindowResult(true)).toThrow(contractError);
  });

  test("AC-007 応答が undefined なら throw する", () => {
    expect(() => toRateWindowResult(undefined)).toThrow(contractError);
  });

  test("AC-008 応答が null なら throw する (Number(null) = 0 を count にしない)", () => {
    expect(() => toRateWindowResult(null)).toThrow(contractError);
  });
});
