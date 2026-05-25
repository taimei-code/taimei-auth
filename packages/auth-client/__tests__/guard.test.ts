import { describe, expect, test } from "bun:test";
import { createAuthGuard } from "../src/guard";
import { Result } from "../src/gen/auth/v1/auth_pb";

// VerifyResult discriminated union 戻り型 (0.6.0 breaking)。
// SDK は副作用なし。consumer framework 固有の制御フロー (redirect 等) は consumer 側 wrapper に委ねる。

type VerifyArgs = { sessionToken: string };

function makeClient(verifySession: (args: VerifyArgs) => Promise<unknown>) {
  return {
    authService: { verifySession },
    userService: {},
  } as unknown as Parameters<typeof createAuthGuard>[0]["client"];
}

const validUser = {
  id: "user-1",
  name: "Alice",
  email: "alice@example.com",
  emailVerified: true,
  image: "https://example.com/a.png",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  defaultCompanyId: "cmp_abcdefghijklmnopqrstuvwx",
};

const validSession = {
  id: "sess-1",
  expiresAt: "2026-12-31T00:00:00Z",
  sessionKind: "user",
};

const okResponse = {
  outcome: {
    case: "ok" as const,
    value: { user: validUser, session: validSession },
  },
};

describe("createAuthGuard.getSession", () => {
  test("G1: token 不在なら ok:false / SESSION_NOT_FOUND を返し verifySession を呼ばない", async () => {
    let rpcCalled = false;
    const guard = createAuthGuard({
      client: makeClient(async () => {
        rpcCalled = true;
        return okResponse;
      }),
      getSessionToken: async () => undefined,
    });

    const result = await guard.getSession();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe(Result.SESSION_NOT_FOUND);
    expect(rpcCalled).toBe(false);
  });

  test("G2: RPC throw → ok:false / UNSPECIFIED", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => {
        throw new Error("connection refused");
      }),
      getSessionToken: async () => "valid-token",
    });

    const result = await guard.getSession();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe(Result.UNSPECIFIED);
  });

  test("G2b: RPC が遅延後 reject (timeout 相当) → UNSPECIFIED", async () => {
    const guard = createAuthGuard({
      client: makeClient(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10)),
      ),
      getSessionToken: async () => "valid-token",
    });

    const result = await guard.getSession();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe(Result.UNSPECIFIED);
  });

  test("G3: outcome.case === 'error' → reason をそのまま返す", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => ({
        outcome: { case: "error", value: { reason: Result.REVISION_OUTDATED } },
      })),
      getSessionToken: async () => "valid-token",
    });

    const result = await guard.getSession();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe(Result.REVISION_OUTDATED);
  });

  test("G4: outcome.case === 'ok' で user/session が欠落 → UNSPECIFIED", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => ({
        outcome: { case: "ok", value: { user: undefined, session: undefined } },
      })),
      getSessionToken: async () => "valid-token",
    });

    const result = await guard.getSession();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe(Result.UNSPECIFIED);
  });

  test("G5: 正常系 — VerifyResult.ok = true で SessionData を返す", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => okResponse),
      getSessionToken: async () => "valid-token",
    });

    const result = await guard.getSession();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.data.user.id).toBe("user-1");
    expect(result.data.session.id).toBe("sess-1");
    expect(result.data.session.kind).toBe("user");
    expect(result.data.companyId).toBe("cmp_abcdefghijklmnopqrstuvwx");
    // IdP 隠蔽: SessionData.session に余計なフィールドが乗らないこと (companyId は top-level に上げる)
    expect(Object.keys(result.data.session).sort()).toEqual(["expiresAt", "id", "kind"]);
  });

  test("G5b: user.defaultCompanyId も session.companyId も無ければ companyId は undefined", async () => {
    const userWithoutCompany = {
      id: "user-2",
      name: "Bob",
      email: "bob@example.com",
      emailVerified: true,
      image: undefined,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    };
    const responseWithoutCompany = {
      outcome: {
        case: "ok" as const,
        value: {
          user: userWithoutCompany,
          session: { id: "sess-2", expiresAt: "2026-12-31T00:00:00Z", sessionKind: "user" },
        },
      },
    };
    const guard = createAuthGuard({
      client: makeClient(async () => responseWithoutCompany),
      getSessionToken: async () => "valid-token",
    });
    const result = await guard.getSession();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.data.companyId).toBeUndefined();
  });

  test("G5c: session.companyId 不在でも user.defaultCompanyId があれば fallback して載せる", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => okResponse),
      getSessionToken: async () => "valid-token",
    });
    const result = await guard.getSession();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.data.companyId).toBe("cmp_abcdefghijklmnopqrstuvwx");
  });

  test("G6: cache 省略時も token 不在で SESSION_NOT_FOUND を返す", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => okResponse),
      getSessionToken: async () => undefined,
    });

    const result = await guard.getSession();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe(Result.SESSION_NOT_FOUND);
  });

  test("G7: cache 注入時に同一 instance の getSession() を 2 回呼ぶと verifySession が 1 回しか呼ばれない", async () => {
    const memo = <Args extends readonly unknown[], R>(fn: (...args: Args) => R) => {
      let cached: { value: R } | null = null;
      return (...args: Args): R => {
        if (cached) return cached.value;
        const value = fn(...args);
        cached = { value };
        return value;
      };
    };

    let rpcCalls = 0;
    const guard = createAuthGuard({
      client: makeClient(async () => {
        rpcCalls += 1;
        return okResponse;
      }),
      getSessionToken: async () => "valid-token",
      cache: memo,
    });

    const a = await guard.getSession();
    const b = await guard.getSession();

    expect(rpcCalls).toBe(1);
    expect(a).toEqual(b);
  });
});
