import { describe, expect, test } from "bun:test";
import type { Role } from "@/db/repositories/membership";
import { canAttemptRemoval, canChangeRole, canRemoveTarget, isAtLeast } from "../policy";

const ROLES: Role[] = ["OWNER", "ADMIN", "MEMBER"];

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

  // ROLE_LEVEL に無い role は fail-closed で false (未知 role の素通しを防ぐ)。
  test("想定外 role 文字列 → false (fail-closed)", () => {
    expect(isAtLeast("SUPERVISOR", "MEMBER")).toBe(false);
  });

  // Object.prototype 上のキー名が own-property 判定をすり抜けて role を素通しさせないこと。
  test("prototype チェーン上のキー名 → false", () => {
    expect(isAtLeast("toString", "MEMBER")).toBe(false);
  });
});

describe("canChangeRole", () => {
  // before/next のどちらかが OWNER に触れる変更は OWNER のみ許可、それ以外は所属していれば可。
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

describe("canAttemptRemoval", () => {
  // 本人退会は無条件、他者除名は ADMIN 以上。
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
  // OWNER を他者が抜くのは OWNER のみ。それ以外は許可。
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
