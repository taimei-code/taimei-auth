import { describe, expect, test } from "bun:test";
import { CompanyActivationStatus } from "../../src/index";

describe("SDK の root は checkMemberships の答えの CompanyActivationStatus を値で出す", () => {
  test("root から読んだ CompanyActivationStatus は proto の値と同じ番号を持つ", () => {
    expect([
      CompanyActivationStatus.ACTIVE,
      CompanyActivationStatus.DELETED,
      CompanyActivationStatus.NOT_FOUND,
    ]).toEqual([1, 2, 3]);
  });
});
