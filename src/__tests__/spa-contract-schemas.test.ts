import { expect, test } from "bun:test";
import { Exit, Schema } from "effect";
import { IsoDateTime } from "../spa-contract-schemas";

const decodes = (value: string) => Exit.isSuccess(Schema.decodeExit(IsoDateTime)(value));

test("SPA の契約の日時は ISO 8601 の日時だけを受け、Date が日付として読める数字や日付だけの値を拒む", () => {
  expect(
    ["2026-03-04T20:00:00.000Z", "2026-03-04T20:00:00Z", "2026-03-05T05:00:00+09:00"].map(decodes),
  ).toEqual([true, true, true]);
  expect(["1", "2026", "2026-03-04", "not a date", ""].map(decodes)).toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
});

test("SPA の契約の日時は、Date#toISOString と同じ文字列に encode する", () => {
  const instant = "2026-11-02T03:04:05.678Z";

  expect(Schema.encodeSync(IsoDateTime)(Schema.decodeSync(IsoDateTime)(instant))).toBe(instant);
});
