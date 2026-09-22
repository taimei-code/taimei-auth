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

// src のテストは @/db を runtime で import しない (test-db-boundary gate)。
const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const satisfies readonly Role[];

describe("isAtLeast", () => {
  // OWNER > ADMIN > MEMBER の全順序で「以上」判定が成り立つ。
  for (const role of ROLES) {
    for (const minRole of ROLES) {
      const level = { MEMBER: 0, ADMIN: 1, OWNER: 2 } as const;
      const expected = level[role] >= level[minRole];
      test(`role=${role} minRole=${minRole} → ${expected}`, () => {
        expect(isAtLeast(role, minRole)).toBe(expected);
      });
    }
  }

  // 未知の role は DB の CHECK 制約により存在しない (ADR-0018)。typecheck が gate であり、runtime の assert は持たない。
  test("想定外 role 文字列は型で拒否される", () => {
    // @ts-expect-error Role 以外の文字列は引数に取れない
    isAtLeast("SUPERVISOR", "MEMBER");
  });
});

describe("canChangeRole", () => {
  // before と next のどちらかが OWNER である変更は OWNER だけに許可し、それ以外は所属していれば許可する。
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
  // role=OWNER の招待は OWNER だけができ、それ以外 (ADMIN/MEMBER の招待) は所属権限の範囲内で発行できる (不変)。
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
  // 本人の退会は無条件で、他者の除名は ADMIN 以上に限る。
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
  // OWNER を他者が除名できるのは OWNER だけである。それ以外は許可する。
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
