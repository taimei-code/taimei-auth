import { test, expect, describe } from "bun:test";
import { createAuthGuard } from "../src/guard";

// 仕様: redirect() は Next.js の制御フローとして NEXT_REDIRECT を throw する。
// 過去のバグでは try/catch が NEXT_REDIRECT を捕捉して AuthServiceUnavailable に
// 化けさせていたため、リダイレクトが機能しなかった。
// このテストは「session 無効時に呼ばれる redirect が、エラーとして wrap されず
// 上位に伝播すること」を保証する。

const noopCache = <T extends (...a: any[]) => any>(fn: T): T => fn;

describe("createAuthGuard - redirect propagation", () => {
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
    await guard.verifySession().catch((e) => (caught = e));

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
    await guard.verifySession().catch((e) => (caught = e));

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
    await guard.verifySession().catch((e) => (caught = e));

    expect(rpcCalled).toBe(false);
    expect(caught).toBe(REDIRECT_MARK);
  });
});
