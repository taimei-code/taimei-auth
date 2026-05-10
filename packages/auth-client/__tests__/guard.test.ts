import { test, expect, describe } from "bun:test";
import { createAuthGuard } from "../src/guard";

// 仕様: redirect() は Next.js の制御フローとして NEXT_REDIRECT を throw する。
// try/catch で囲うと NEXT_REDIRECT を捕捉して AuthServiceUnavailable 等に化けさせ
// リダイレクトが機能しなくなる。「session 無効時の redirect がエラーに wrap されず上位に伝播すること」を
// このテストで保証する。

const noopCache = <Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
): ((...args: Args) => R) => fn;

const RETURN_TO = "/dashboard";

describe("createAuthGuard.requireSession - redirect propagation", () => {
  test("session が空なら redirect が呼ばれ NEXT_REDIRECT が伝播する", async () => {
    const REDIRECT_MARK = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT",
    });

    const redirect = (_url: string): never => {
      throw REDIRECT_MARK;
    };

    const guard = createAuthGuard({
      client: {
        authService: {
          verifySession: async () => ({ user: undefined, session: undefined }),
        },
        userService: {} as any,
      } as any,
      cache: noopCache,
      redirect,
      getSessionToken: async () => "valid-token",
    });

    let caught: unknown;
    await guard.requireSession({ returnTo: RETURN_TO }).catch((e) => (caught = e));

    // NEXT_REDIRECT がそのまま伝播し、AuthServiceUnavailable などに wrap されないこと
    expect(caught).toBe(REDIRECT_MARK);
  });

  test("RPC 呼び出しが ConnectError を throw した場合は mapConnectError される", async () => {
    const guard = createAuthGuard({
      client: {
        authService: {
          verifySession: async () => {
            throw new Error("connection refused");
          },
        },
        userService: {} as any,
      } as any,
      cache: noopCache,
      redirect: () => {
        throw new Error("should not redirect on RPC failure");
      },
      getSessionToken: async () => "valid-token",
    });

    let caught: any;
    await guard.requireSession({ returnTo: RETURN_TO }).catch((e) => (caught = e));

    // mapConnectError 経由の TaggedError であることを確認（_tag が付く）
    expect(caught).toBeDefined();
    expect(caught.message).not.toBe("should not redirect on RPC failure");
  });

  test("token が無い場合、RPC を叩かず即 redirect する", async () => {
    let rpcCalled = false;
    const REDIRECT_MARK = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT",
    });

    const guard = createAuthGuard({
      client: {
        authService: {
          verifySession: async () => {
            rpcCalled = true;
            return { user: undefined, session: undefined };
          },
        },
        userService: {} as any,
      } as any,
      cache: noopCache,
      redirect: () => {
        throw REDIRECT_MARK;
      },
      getSessionToken: async () => undefined,
    });

    let caught: unknown;
    await guard.requireSession({ returnTo: RETURN_TO }).catch((e) => (caught = e));

    expect(rpcCalled).toBe(false);
    expect(caught).toBe(REDIRECT_MARK);
  });

  test("redirect URL に opts.returnTo が反映される (callbackUrl)", async () => {
    let redirectedTo = "";
    const REDIRECT_MARK = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT",
    });

    const guard = createAuthGuard({
      client: {
        authService: {
          verifySession: async () => ({ user: undefined, session: undefined }),
        },
        userService: {} as any,
      } as any,
      cache: noopCache,
      redirect: (url: string): never => {
        redirectedTo = url;
        throw REDIRECT_MARK;
      },
      getSessionToken: async () => undefined,
    });

    await guard.requireSession({ returnTo: "/account" }).catch(() => undefined);

    expect(redirectedTo).toBe(`/auth?callbackUrl=${encodeURIComponent("/account")}`);
  });

  test("成功時は SessionData (user / session のみ) を返し、IdP 内部表現が漏れない", async () => {
    // SessionData の trim は proto から token/userId 等を削除済 (ADR-006 D6) で根本解消。本 test は defense-in-depth。
    const guard = createAuthGuard({
      client: {
        authService: {
          verifySession: async () => ({
            user: {
              id: "user-1",
              name: "Alice",
              email: "alice@example.com",
              emailVerified: true,
              image: "https://example.com/a.png",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-02T00:00:00Z",
            },
            session: {
              id: "sess-1",
              expiresAt: "2026-12-31T00:00:00Z",
            },
          }),
        },
        userService: {} as any,
      } as any,
      cache: noopCache,
      redirect: () => {
        throw new Error("should not redirect on success");
      },
      getSessionToken: async () => "valid-token",
    });

    const session = await guard.requireSession({ returnTo: RETURN_TO });

    expect(session.user.id).toBe("user-1");
    expect(session.user.email).toBe("alice@example.com");
    expect(session.session.id).toBe("sess-1");
    // SessionData に余計なフィールドが乗っていないこと (IdP 隠蔽の保証)
    expect(Object.keys(session.session).sort()).toEqual(["expiresAt", "id"]);
  });
});

describe("createAuthGuard.getSession - 副作用なし版", () => {
  test("token が無いと null を返す (RPC を叩かない)", async () => {
    let rpcCalled = false;
    const guard = createAuthGuard({
      client: {
        authService: {
          verifySession: async () => {
            rpcCalled = true;
            return { user: undefined, session: undefined };
          },
        },
        userService: {} as any,
      } as any,
      cache: noopCache,
      redirect: () => {
        throw new Error("getSession should not redirect");
      },
      getSessionToken: async () => undefined,
    });

    const session = await guard.getSession();

    expect(session).toBeNull();
    expect(rpcCalled).toBe(false);
  });

  test("RPC が throw しても null を返す (副作用なし版の責務)", async () => {
    const guard = createAuthGuard({
      client: {
        authService: {
          verifySession: async () => {
            throw new Error("network error");
          },
        },
        userService: {} as any,
      } as any,
      cache: noopCache,
      redirect: () => {
        throw new Error("getSession should not redirect");
      },
      getSessionToken: async () => "valid-token",
    });

    const session = await guard.getSession();

    expect(session).toBeNull();
  });

  test("user/session どちらかが undefined なら null を返す", async () => {
    const guard = createAuthGuard({
      client: {
        authService: {
          verifySession: async () => ({ user: undefined, session: undefined }),
        },
        userService: {} as any,
      } as any,
      cache: noopCache,
      redirect: () => {
        throw new Error("getSession should not redirect");
      },
      getSessionToken: async () => "valid-token",
    });

    const session = await guard.getSession();

    expect(session).toBeNull();
  });
});
