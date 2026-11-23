import { describe, expect, test } from "bun:test";
import type { RegisteredFlagCatalog } from "../feature-flag-catalog";

describe("フィーチャーフラグのページの一覧は、型に登録したフラグを漏らさない", () => {
  test("型に登録したフラグを欠いた一覧は、型検査で落ちる", () => {
    // @ts-expect-error passkey を欠いた一覧は、登録したフラグを漏らしている
    const missingPasskey: RegisteredFlagCatalog = {};

    expect(Object.keys(missingPasskey)).toEqual([]);
  });

  test("ページが使う一覧は、登録したフラグを評価の対象とともにすべて持つ", async () => {
    const { FEATURE_FLAG_CATALOG } = await import("../feature-flag-catalog");

    const catalog: RegisteredFlagCatalog = FEATURE_FLAG_CATALOG;

    expect(catalog).toEqual({ passkey: "everyone" });
  });
});
