import { describe, expect, test } from "bun:test";
import { toRateWindowResult } from "../redis";

// MULTI INCR/EXPIRE/TTL の exec 応答 → RateWindowResult の純関数 (設計 AC-001〜AC-012)。
// 何を契約逸脱として throw するか、なぜ 0 に潰さないかの根拠は redis.ts の toRateWindowResult 冒頭コメントが正本。
describe("toRateWindowResult", () => {
  const contractError = /^incrementRateWindow:/;

  test("AC-001 正常応答は count と ttl をそのまま返す", () => {
    expect(toRateWindowResult([3, 1, 55], 60)).toEqual({ count: 3, ttl: 55 });
  });

  test("AC-002 count は文字列でも数値に強制変換する", () => {
    expect(toRateWindowResult(["5", 1, 55], 60).count).toBe(5);
  });

  test("AC-003 count 1 (下限) は通す", () => {
    expect(toRateWindowResult([1, 1, 60], 60).count).toBe(1);
  });

  test("AC-004 count 0 は契約逸脱として throw する", () => {
    expect(() => toRateWindowResult([0, 1, 60], 60)).toThrow(contractError);
  });

  test("AC-005 count が NaN になる値は throw する", () => {
    expect(() => toRateWindowResult(["abc", 1, 60], 60)).toThrow(contractError);
  });

  test("AC-006 count が boolean なら強制変換せず throw する (位置ずれの true を 1 にしない)", () => {
    expect(() => toRateWindowResult([true, true, 60], 60)).toThrow(contractError);
  });

  test("AC-007 応答が undefined なら throw する", () => {
    expect(() => toRateWindowResult(undefined, 60)).toThrow(contractError);
  });

  test("AC-008 応答が配列でなければ throw する", () => {
    expect(() => toRateWindowResult("not-array", 60)).toThrow(contractError);
  });

  test("AC-009 ttl 欠損は windowSec に fallback する", () => {
    expect(toRateWindowResult([2, 1, undefined], 60)).toEqual({ count: 2, ttl: 60 });
  });

  test("AC-010 ttl -1 (EXPIRE 無し) は windowSec に fallback する", () => {
    expect(toRateWindowResult([2, 1, -1], 60).ttl).toBe(60);
  });

  test("AC-011 ttl 0 は windowSec に fallback する", () => {
    expect(toRateWindowResult([2, 1, 0], 60).ttl).toBe(60);
  });

  test("AC-012 ttl 1 (下限) はそのまま返す", () => {
    expect(toRateWindowResult([2, 1, 1], 60).ttl).toBe(1);
  });
});
