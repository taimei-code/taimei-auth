import { describe, expect, test } from "bun:test";
import type { Role } from "../policy";
import {
  canAcceptInvitedRole,
  canAttemptRemoval,
  canChangeRole,
  canInviteRole,
  canRemoveTarget,
  isAtLeast,
  requiresOwnerProtection,
} from "../policy";

const ROLES: Role[] = ["OWNER", "ADMIN", "MEMBER"];

describe("requiresOwnerProtection", () => {
  // OWNER 保護判定の共有式 (server 述語と web の出し分けが同居)。既知 role は OWNER のみ true。
  test("OWNER → true", () => {
    expect(requiresOwnerProtection("OWNER")).toBe(true);
  });
  for (const role of ["ADMIN", "MEMBER"]) {
    test(`${role} → false`, () => {
      expect(requiresOwnerProtection(role)).toBe(false);
    });
  }

  // 未知 role は保護対象に含める (fail-closed)。prototype 上のキー名も素通しさせない。
  test("想定外 role 文字列 → true (fail-closed)", () => {
    expect(requiresOwnerProtection("SUPERVISOR")).toBe(true);
  });
  test("prototype チェーン上のキー名 → true (fail-closed)", () => {
    expect(requiresOwnerProtection("constructor")).toBe(true);
  });
});

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

describe("canInviteRole", () => {
  // role=OWNER の招待は OWNER のみ、それ以外 (ADMIN/MEMBER 招待) は所属権限内で発行可 (不変)。
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

describe("canAcceptInvitedRole", () => {
  // QA-M-06 3×3 の全 (invitedRole, inviterCurrentRole) — OWNER 招待は inviter OWNER のみ true、
  // それ以外の invitedRole は inviter role を問わず true。
  for (const invited of ROLES) {
    for (const inviter of ROLES) {
      const expected = invited === "OWNER" ? inviter === "OWNER" : true;
      test(`invited=${invited} inviter=${inviter} → ${expected}`, () => {
        expect(canAcceptInvitedRole(invited, inviter)).toBe(expected);
      });
    }
  }

  // QA-M-06 招待者 membership 行が存在しない (除名済 / 退会) — OWNER 招待だけ false に倒し、
  // ADMIN/MEMBER 招待は招待者退会の正規ケースを壊さないよう true のまま。
  test("inviter null で invited=OWNER → false (fail-closed)", () => {
    expect(canAcceptInvitedRole("OWNER", null)).toBe(false);
  });
  test("inviter null で invited=ADMIN/MEMBER → true (招待者退会の正規ケース)", () => {
    expect(canAcceptInvitedRole("ADMIN", null)).toBe(true);
    expect(canAcceptInvitedRole("MEMBER", null)).toBe(true);
  });

  // QA-D-03 未知の invitedRole (直接 INSERT された unknown 文字列) は Object.hasOwn で fail-closed。
  test("invited=想定外 role 文字列 → false", () => {
    expect(canAcceptInvitedRole("SUPERVISOR", "OWNER")).toBe(false);
    expect(canAcceptInvitedRole("", "OWNER")).toBe(false);
  });

  // prototype チェーン上のキー名が role 判定を素通しさせないこと。
  test("invited=toString → false (prototype pollution 予防)", () => {
    expect(canAcceptInvitedRole("toString", "OWNER")).toBe(false);
  });
});
