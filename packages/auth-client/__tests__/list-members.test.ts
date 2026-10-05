import { describe, expect, test } from "bun:test";
import { createAuthGuard } from "../src/guard";
import { Result, Role as ProtoRole } from "../src/gen/auth/v1/auth_pb";

type GuardOptions = Parameters<typeof createAuthGuard>[0];

const sessionIn = (companyId: string | undefined) => async () => ({
  outcome: {
    case: "ok" as const,
    value: {
      user: { id: "u1", name: "n", email: "e", emailVerified: true, defaultCompanyId: companyId },
      session: { id: "s1", expiresAt: "2030-01-01T00:00:00Z", sessionKind: "user" },
    },
  },
});

const guardOf = ({
  list,
  verifySession = sessionIn("cmp_1"),
  getSessionToken = async () => "valid-token",
  cache,
}: {
  list: () => Promise<unknown>;
  verifySession?: () => Promise<unknown>;
  getSessionToken?: GuardOptions["getSessionToken"];
  cache?: GuardOptions["cache"];
}) =>
  createAuthGuard({
    client: {
      authService: { verifySession, listCurrentCompanyMembers: list },
      userService: {},
    } as unknown as GuardOptions["client"],
    getSessionToken,
    cache,
  });

const ok = (value: unknown) => async () => ({ outcome: { case: "ok" as const, value } });

const member = (userId: string, role: ProtoRole) => ({
  userId,
  name: `name-${userId}`,
  email: `${userId}@example.com`,
  role,
});

describe("createAuthGuard.listMembers", () => {
  test("AC-020: token が無ければ RPC を呼ばずに SESSION_NOT_FOUND", async () => {
    let called = false;
    const guard = guardOf({
      list: async () => {
        called = true;
        return {};
      },
      getSessionToken: async () => undefined,
    });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.SESSION_NOT_FOUND });
    expect(called).toBe(false);
  });

  test("AC-021: RPC が throw したら UNSPECIFIED", async () => {
    const guard = guardOf({
      list: async () => {
        throw new Error("connection refused");
      },
    });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.UNSPECIFIED });
  });

  test("AC-022: error の reason をそのまま返す", async () => {
    const guard = guardOf({
      list: async () => ({
        outcome: { case: "error", value: { reason: Result.REVISION_OUTDATED } },
      }),
    });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.REVISION_OUTDATED });
  });

  test("AC-023: ok の事業所とメンバーを文字列の role で返す", async () => {
    const guard = guardOf({
      list: ok({
        companyId: "cmp_1",
        members: [
          member("u1", ProtoRole.OWNER),
          member("u2", ProtoRole.ADMIN),
          member("u3", ProtoRole.MEMBER),
        ],
      }),
    });

    expect(await guard.listMembers()).toEqual({
      ok: true,
      data: {
        companyId: "cmp_1",
        members: [
          { userId: "u1", name: "name-u1", email: "u1@example.com", role: "OWNER" },
          { userId: "u2", name: "name-u2", email: "u2@example.com", role: "ADMIN" },
          { userId: "u3", name: "name-u3", email: "u3@example.com", role: "MEMBER" },
        ],
      },
    });
  });

  test("AC-043: 知らない role の人は role を undefined にし、ほかの人の role はそのまま返す", async () => {
    const guard = guardOf({
      list: ok({
        companyId: "cmp_1",
        members: [member("u1", ProtoRole.OWNER), member("u2", ProtoRole.UNSPECIFIED)],
      }),
    });

    const result = await guard.listMembers();

    if (!result.ok) throw new Error("not ok");
    expect(result.data.members.map((m) => [m.userId, m.role])).toEqual([
      ["u1", "OWNER"],
      ["u2", undefined],
    ]);
  });

  test("AC-025: 事業所未選択は companyId undefined と空の一覧", async () => {
    const guard = guardOf({ list: ok({ members: [] }), verifySession: sessionIn(undefined) });

    expect(await guard.listMembers()).toEqual({
      ok: true,
      data: { companyId: undefined, members: [] },
    });
  });

  test("AC-044: 一覧の事業所が getSession の companyId と違えば UNSPECIFIED", async () => {
    const guard = guardOf({
      list: ok({ companyId: "cmp_2", members: [member("u1", ProtoRole.OWNER)] }),
    });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.UNSPECIFIED });
  });

  test("AC-045: getSession が失敗したら、その reason を返して一覧の RPC を呼ばない", async () => {
    let called = false;
    const guard = guardOf({
      list: async () => {
        called = true;
        return {};
      },
      verifySession: async () => ({
        outcome: { case: "error", value: { reason: Result.REVISION_OUTDATED } },
      }),
    });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.REVISION_OUTDATED });
    expect(called).toBe(false);
  });

  test("AC-026: cache を渡すと 2 回呼んでも RPC は 1 回", async () => {
    let calls = 0;
    const cacheFirstCall: GuardOptions["cache"] = (fn) => {
      let memo: ReturnType<typeof fn> | undefined;
      return (...args) => {
        memo ??= fn(...args);
        return memo;
      };
    };
    const guard = guardOf({
      list: async () => {
        calls += 1;
        return { outcome: { case: "ok", value: { companyId: "cmp_1", members: [] } } };
      },
      cache: cacheFirstCall,
    });

    const results = [await guard.listMembers(), await guard.listMembers()];

    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(calls).toBe(1);
  });

  test("AC-039: outcome が未設定なら UNSPECIFIED", async () => {
    const guard = guardOf({ list: async () => ({ outcome: { case: undefined } }) });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.UNSPECIFIED });
  });
});
