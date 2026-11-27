import { describe, expect, test } from "bun:test";
import { Record } from "effect";
import type { FlagAudience } from "../../src/feature-flags";
import { FEATURE_FLAG_CATALOG, type RegisteredFlagCatalog } from "../feature-flag-catalog";

const FLAG_AUDIENCES: { readonly [Audience in FlagAudience]: true } = {
  everyone: true,
  companies: true,
};

describe("本番以外の flag の一覧は、型に登録したフラグを漏らさない", () => {
  test("型に登録したフラグを欠いた一覧は、型検査で落ちる", () => {
    // @ts-expect-error
    const missingEveryFlag: RegisteredFlagCatalog = {};

    expect(Object.keys(missingEveryFlag)).toEqual([]);
  });

  test("一覧は、登録したフラグを、全体か事業所のどちらかの評価の対象とともにすべて持つ", () => {
    const catalog: RegisteredFlagCatalog = FEATURE_FLAG_CATALOG;

    expect(
      Object.values(catalog).filter((audience) => !Object.hasOwn(FLAG_AUDIENCES, audience)),
    ).toEqual([]);
  });

  test("一覧はフラグを 1 つ以上持ち、一覧の名前で回す偽物と試験 API の test が 1 件も走らずに通ることは無い", () => {
    expect(Record.keys(FEATURE_FLAG_CATALOG)).not.toEqual([]);
  });
});
