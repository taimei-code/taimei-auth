import { describe, expect, test } from "bun:test";
import { createAuthGuard } from "../src/guard";

// ADR-007 後の guard.ts: 副作用なし getSession のみを提供。
// consumer framework 固有の制御フロー (redirect 等) は SDK には含めず、SDK は SessionData | null を返すだけ。

type VerifyArgs = {
  sessionToken: string;
};

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
};

const validSession = {
  id: "sess-1",
  expiresAt: "2026-12-31T00:00:00Z",
};

describe("createAuthGuard.getSession", () => {
  test("G1: token 不在なら null を返し、verifySession を呼ばない", async () => {
    let rpcCalled = false;
    const guard = createAuthGuard({
      client: makeClient(async () => {
        rpcCalled = true;
        return { user: validUser, session: validSession };
      }),
      getSessionToken: async () => undefined,
    });

    const session = await guard.getSession();

    expect(session).toBeNull();
    expect(rpcCalled).toBe(false);
  });

  test("G2: RPC が throw しても null を返す (副作用なし版の責務)", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => {
        throw new Error("connection refused");
      }),
      getSessionToken: async () => "valid-token",
    });

    const session = await guard.getSession();

    expect(session).toBeNull();
  });

  test("G3: user が undefined なら null", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => ({ user: undefined, session: validSession })),
      getSessionToken: async () => "valid-token",
    });

    expect(await guard.getSession()).toBeNull();
  });

  test("G4: session が undefined なら null", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => ({ user: validUser, session: undefined })),
      getSessionToken: async () => "valid-token",
    });

    expect(await guard.getSession()).toBeNull();
  });

  test("G5: 正常系 — SessionData (user + session のみ) を返す", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => ({ user: validUser, session: validSession })),
      getSessionToken: async () => "valid-token",
    });

    const session = await guard.getSession();

    expect(session).not.toBeNull();
    expect(session?.user.id).toBe("user-1");
    expect(session?.session.id).toBe("sess-1");
    // IdP 隠蔽: SessionData.session に余計なフィールドが乗らないこと
    expect(Object.keys(session?.session ?? {}).sort()).toEqual(["expiresAt", "id"]);
  });

  test("G6a: cache 省略時も正常系で SessionData を返す", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => ({ user: validUser, session: validSession })),
      getSessionToken: async () => "valid-token",
    });

    const session = await guard.getSession();
    expect(session?.user.id).toBe("user-1");
  });

  test("G6b: cache 省略時も token 不在で null を返す", async () => {
    const guard = createAuthGuard({
      client: makeClient(async () => ({ user: undefined, session: undefined })),
      getSessionToken: async () => undefined,
    });

    expect(await guard.getSession()).toBeNull();
  });

  test("G7: cache 注入時に同一 instance の getSession() を 2 回呼ぶと verifySession が 1 回しか呼ばれない", async () => {
    // 簡易メモ化: 1 引数までの fn を arity 無視で 1 回だけ実行する。
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
        return { user: validUser, session: validSession };
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
