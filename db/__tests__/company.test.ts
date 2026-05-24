import { describe, expect, test } from "bun:test";
import { generateCompanyId } from "../repositories/company";
import { generateInvitationId } from "../repositories/invitation";
import { generateMembershipId } from "../repositories/membership";

describe("ID generator format", () => {
  test("generateCompanyId は cmp_<24chars> URL-safe alphabet を返す", () => {
    const id = generateCompanyId();
    expect(id).toMatch(/^cmp_[A-Za-z0-9_-]{24}$/);
  });

  test("generateMembershipId は mbr_<24chars> URL-safe alphabet を返す", () => {
    const id = generateMembershipId();
    expect(id).toMatch(/^mbr_[A-Za-z0-9_-]{24}$/);
  });

  test("generateInvitationId は inv_<24chars> URL-safe alphabet を返す", () => {
    const id = generateInvitationId();
    expect(id).toMatch(/^inv_[A-Za-z0-9_-]{24}$/);
  });

  test("複数回呼んで衝突しない (100 回連続 unique)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCompanyId());
    }
    expect(ids.size).toBe(100);
  });
});
