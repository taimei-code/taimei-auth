import { describe, expect, test } from "bun:test";
import type { InviterVerdict, Role } from "../policy";
import {
  canAttemptRemoval,
  canChangeRole,
  canInviteRole,
  canRemoveTarget,
  isAtLeast,
  verifyInviter,
} from "../policy";

const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const satisfies readonly Role[];

describe("isAtLeast", () => {
  for (const role of ROLES) {
    for (const minRole of ROLES) {
      const level = { MEMBER: 0, ADMIN: 1, OWNER: 2 } as const;
      const expected = level[role] >= level[minRole];
      test(`role=${role} minRole=${minRole} → ${expected}`, () => {
        expect(isAtLeast(role, minRole)).toBe(expected);
      });
    }
  }

  test("想定外 role 文字列は型で拒否される", () => {
    // @ts-expect-error Role 以外の文字列は引数に取れない
    isAtLeast("SUPERVISOR", "MEMBER");
  });
});

describe("canChangeRole", () => {
  for (const actor of ROLES) {
    for (const before of ROLES) {
      for (const next of ROLES) {
        const touchesOwner = before === "OWNER" || next === "OWNER";
        const expected = touchesOwner ? actor === "OWNER" : true;
        test(`actor=${actor} before=${before} next=${next} → ${expected}`, () => {
          expect(canChangeRole(actor, before, next)).toBe(expected);
        });
      }
    }
  }
});

describe("canInviteRole", () => {
  for (const actor of ROLES) {
    for (const invited of ROLES) {
      const expected = invited === "OWNER" ? actor === "OWNER" : true;
      test(`actor=${actor} invited=${invited} → ${expected}`, () => {
        expect(canInviteRole(actor, invited)).toBe(expected);
      });
    }
  }
});

describe("canAttemptRemoval", () => {
  for (const actor of ROLES) {
    for (const isSelf of [true, false]) {
      const expected = isSelf || actor === "OWNER" || actor === "ADMIN";
      test(`actor=${actor} isSelf=${isSelf} → ${expected}`, () => {
        expect(canAttemptRemoval(actor, isSelf)).toBe(expected);
      });
    }
  }
});

describe("canRemoveTarget", () => {
  for (const actor of ROLES) {
    for (const isSelf of [true, false]) {
      for (const target of ROLES) {
        const expected = !(target === "OWNER" && !isSelf && actor !== "OWNER");
        test(`actor=${actor} isSelf=${isSelf} target=${target} → ${expected}`, () => {
          expect(canRemoveTarget(actor, isSelf, target)).toBe(expected);
        });
      }
    }
  }
});

describe("verifyInviter", () => {
  test("行なし → Reject (Missing)", () => {
    expect(verifyInviter(undefined)).toEqual({ _tag: "Reject", seen: { _tag: "Missing" } });
  });
  for (const role of ROLES) {
    const expected: InviterVerdict =
      role === "OWNER" ? { _tag: "Accept" } : { _tag: "Reject", seen: { _tag: "Demoted", role } };
    test(`${role} → ${expected._tag}`, () => {
      expect(verifyInviter({ role })).toEqual(expected);
    });
  }
});
