import { describe, expect, mock, test } from "bun:test";
import { Code, ConnectError } from "@connectrpc/connect";
import { createAuthGuard } from "../guard";
import { Result, Role as ProtoRole } from "../gen/auth/v1/auth_pb";

type GuardOptions = Parameters<typeof createAuthGuard>[0];
type Rpc = (request: { sessionToken: string }) => Promise<unknown>;

const user = (companyId: string | undefined) => ({
  id: "u1",
  name: "n",
  email: "e",
  emailVerified: true,
  defaultCompanyId: companyId,
});
const session = { id: "s1", expiresAt: "2030-01-01T00:00:00Z", sessionKind: "user" };

const ok = (value: unknown) => async (_request?: unknown) => ({
  outcome: { case: "ok" as const, value },
});
const failWith = (reason: Result) => async () => ({
  outcome: { case: "error" as const, value: { reason } },
});

const member = (userId: string, role: ProtoRole) => ({
  userId,
  name: `name-${userId}`,
  email: `${userId}@example.com`,
  role,
});

const guardOf = ({
  getSession,
  verifySession = mock(async () => ({ outcome: { case: undefined } })),
  list = mock(async () => ({ outcome: { case: undefined } })),
  getSessionToken = async () => "valid-token",
  cache,
}: {
  getSession: Rpc;
  verifySession?: Rpc;
  list?: Rpc;
  getSessionToken?: GuardOptions["getSessionToken"];
  cache?: GuardOptions["cache"];
}) =>
  createAuthGuard({
    client: {
      authService: { getSession, verifySession, listCurrentCompanyMembers: list },
      userService: {},
    } as unknown as GuardOptions["client"],
    getSessionToken,
    cache,
  });

const cacheFirstCall: GuardOptions["cache"] = (fn) => {
  let memo: ReturnType<typeof fn> | undefined;
  return (...args) => {
    memo ??= fn(...args);
    return memo;
  };
};

describe("createAuthGuard.listMembers", () => {
  test("token が無ければ、getSession と listMembers はどちらも RPC を呼ばずに SESSION_NOT_FOUND を返す", async () => {
    const rpcs = [mock(async () => ({})), mock(async () => ({})), mock(async () => ({}))];
    const [getSession, verifySession, list] = rpcs;
    const guard = guardOf({
      getSession,
      verifySession,
      list,
      getSessionToken: async () => undefined,
    });

    expect([await guard.getSession(), await guard.listMembers()]).toEqual([
      { ok: false, reason: Result.SESSION_NOT_FOUND },
      { ok: false, reason: Result.SESSION_NOT_FOUND },
    ]);
    expect(rpcs.map((rpc) => rpc.mock.calls.length)).toEqual([0, 0, 0]);
  });

  test("RPC が throw したら UNSPECIFIED を返す", async () => {
    const guard = guardOf({
      getSession: async () => {
        throw new Error("connection refused");
      },
    });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.UNSPECIFIED });
  });

  test("error の reason をそのまま返す", async () => {
    const guard = guardOf({ getSession: failWith(Result.USER_DELETED) });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.USER_DELETED });
  });

  test("本人の role 付きの応答なら、getSession と同じ companyId とメンバーを文字列の role で返す", async () => {
    const guard = guardOf({
      getSession: ok({
        user: user("cmp_1"),
        session,
        currentRole: ProtoRole.OWNER,
        members: [
          member("u1", ProtoRole.OWNER),
          member("u2", ProtoRole.ADMIN),
          member("u3", ProtoRole.MEMBER),
        ],
      }),
    });

    const sessionResult = await guard.getSession();
    if (!sessionResult.ok) throw new Error("not ok");
    expect(await guard.listMembers()).toEqual({
      ok: true,
      data: {
        companyId: sessionResult.data.companyId,
        members: [
          { userId: "u1", name: "name-u1", email: "u1@example.com", role: "OWNER" },
          { userId: "u2", name: "name-u2", email: "u2@example.com", role: "ADMIN" },
          { userId: "u3", name: "name-u3", email: "u3@example.com", role: "MEMBER" },
        ],
      },
    });
    expect(sessionResult.data.companyId).toBe("cmp_1");
  });

  test("知らない role の人は role を undefined にし、ほかの人の role はそのまま返す", async () => {
    const guard = guardOf({
      getSession: ok({
        user: user("cmp_1"),
        session,
        currentRole: ProtoRole.ADMIN,
        members: [member("u1", ProtoRole.ADMIN), member("u2", 99 as ProtoRole)],
      }),
    });

    const result = await guard.listMembers();

    if (!result.ok) throw new Error("not ok");
    expect(result.data.members.map((m) => [m.userId, m.role])).toEqual([
      ["u1", "ADMIN"],
      ["u2", undefined],
    ]);
  });

  test("本人の role が無く一覧が空なら、companyId は undefined で一覧は空", async () => {
    const guard = guardOf({ getSession: ok({ user: user("cmp_1"), session, members: [] }) });

    expect(await guard.listMembers()).toEqual({
      ok: true,
      data: { companyId: undefined, members: [] },
    });
  });

  test("outcome が未設定なら UNSPECIFIED を返す", async () => {
    const guard = guardOf({ getSession: async () => ({ outcome: { case: undefined } }) });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.UNSPECIFIED });
  });

  test("同じ cache を渡すと、getSession と listMembers を続けて呼んでも GetSession は 1 回", async () => {
    const getSession = mock(ok({ user: user("cmp_1"), session, members: [] }));
    const guard = guardOf({ getSession, cache: cacheFirstCall });

    await guard.getSession();
    await guard.listMembers();

    expect(getSession).toHaveBeenCalledTimes(1);
  });

  test("cache を渡さなければ、getSession と listMembers はそれぞれ GetSession を 1 回呼び、旧 RPC は呼ばない", async () => {
    const getSession = mock(ok({ user: user("cmp_1"), session, members: [] }));
    const verifySession = mock(async () => ({}));
    const list = mock(async () => ({}));
    const guard = guardOf({ getSession, verifySession, list });

    await guard.getSession();
    await guard.listMembers();

    expect([getSession, verifySession, list].map((rpc) => rpc.mock.calls.length)).toEqual([
      2, 0, 0,
    ]);
  });
});

describe("GetSession を持たない auth ホストには、VerifySession と ListCurrentCompanyMembers で答える", () => {
  const unimplemented = async () => {
    throw new ConnectError("", Code.Unimplemented);
  };
  const verifiedIn = (companyId: string | undefined) =>
    ok({ user: user(companyId), session, currentRole: ProtoRole.OWNER });

  test("GetSession が Unimplemented なら、getSession は VerifySession を 1 回呼んでその応答から結果を作る", async () => {
    const verifySession = mock(verifiedIn("cmp_1"));
    const guard = guardOf({ getSession: unimplemented, verifySession });

    const result = await guard.getSession();

    expect(verifySession.mock.calls).toEqual([[{ sessionToken: "valid-token" }]]);
    if (!result.ok) throw new Error("not ok");
    expect([result.data.user.id, result.data.companyId, result.data.role]).toEqual([
      "u1",
      "cmp_1",
      "OWNER",
    ]);
  });

  test("GetSession が Unimplemented で、一覧の事業所が VerifySession と同じなら、一覧を文字列の role で返す", async () => {
    const guard = guardOf({
      getSession: unimplemented,
      verifySession: verifiedIn("cmp_1"),
      list: ok({ companyId: "cmp_1", members: [member("u1", ProtoRole.OWNER)] }),
    });

    expect(await guard.listMembers()).toEqual({
      ok: true,
      data: {
        companyId: "cmp_1",
        members: [{ userId: "u1", name: "name-u1", email: "u1@example.com", role: "OWNER" }],
      },
    });
  });

  test("GetSession が Unimplemented で、一覧の事業所が VerifySession と違えば UNSPECIFIED を返す", async () => {
    const guard = guardOf({
      getSession: unimplemented,
      verifySession: verifiedIn("cmp_1"),
      list: ok({ companyId: "cmp_2", members: [member("u1", ProtoRole.OWNER)] }),
    });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.UNSPECIFIED });
  });

  test("GetSession が Unimplemented で VerifySession が失敗したら、その reason を返して一覧の RPC を呼ばない", async () => {
    const list = mock(async () => ({}));
    const guard = guardOf({
      getSession: unimplemented,
      verifySession: failWith(Result.REVISION_OUTDATED),
      list,
    });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.REVISION_OUTDATED });
    expect(list).not.toHaveBeenCalled();
  });

  test("GetSession が Unimplemented で、VerifySession が ok で一覧の RPC が失敗したら、getSession は ok のままで listMembers だけが UNSPECIFIED を返す", async () => {
    const guard = guardOf({
      getSession: unimplemented,
      verifySession: verifiedIn("cmp_1"),
      list: async () => {
        throw new ConnectError("", Code.Unavailable);
      },
    });

    const [session, members] = [await guard.getSession(), await guard.listMembers()];

    expect(session.ok).toBe(true);
    expect(members).toEqual({ ok: false, reason: Result.UNSPECIFIED });
  });

  test("GetSession が Unimplemented で、除名直後で一覧の事業所が空なら、3.3.0 と同じく UNSPECIFIED を返す", async () => {
    const guard = guardOf({
      getSession: unimplemented,
      verifySession: ok({ user: user("cmp_1"), session }),
      list: ok({ members: [] }),
    });

    expect(await guard.listMembers()).toEqual({ ok: false, reason: Result.UNSPECIFIED });
  });

  test("GetSession が Unimplemented 以外で失敗したら、VerifySession を呼ばずに UNSPECIFIED を返す", async () => {
    const verifySession = mock(verifiedIn("cmp_1"));
    const guard = guardOf({
      getSession: async () => {
        throw new ConnectError("", Code.Unavailable);
      },
      verifySession,
    });

    expect(await guard.getSession()).toEqual({ ok: false, reason: Result.UNSPECIFIED });
    expect(verifySession).not.toHaveBeenCalled();
  });
});
