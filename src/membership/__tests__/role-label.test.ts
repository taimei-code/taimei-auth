import { describe, expect, test } from "bun:test";
import type { Role } from "../policy";
import { ROLE_LABELS_JA, roleLabelJa } from "../role-label";

describe("roleLabelJa", () => {
  for (const role of Object.keys(ROLE_LABELS_JA) as Role[]) {
    test(`${role} → ${ROLE_LABELS_JA[role]}`, () => {
      expect(roleLabelJa(role)).toBe(ROLE_LABELS_JA[role]);
    });
  }

  test("bundle が知らない role は raw を返し空欄にしない", () => {
    expect(roleLabelJa("SUPERVISOR" as never)).toBe("SUPERVISOR");
  });
});
