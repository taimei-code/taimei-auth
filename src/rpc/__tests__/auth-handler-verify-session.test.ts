import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { findAccountByUserId } from "@/db/repositories/account";
import { findUserById } from "@/db/repositories/user";
import { auth } from "../../auth";
import { Result, type VerifySessionResponse } from "../../gen/auth/v1/auth_pb";

// bun の mock.module はプロセス全体に効き、mock.restore() でも実装は戻らない。mock 適用前の
// 実 module をここで捕捉し、afterAll で貼り直して後続テストファイルへの mock 漏れを防ぐ。
const realModules = {
  auth: { auth },
  userRepository: { findUserById },
  accountRepository: { findAccountByUserId },
};

const mockGetSession = mock();
const mockSignOut = mock();
const mockFindUserById = mock();

type VerifySessionFn = (req: { sessionToken: string }) => Promise<VerifySessionResponse>;

let verifySession: VerifySessionFn;

beforeEach(async () => {
  mockGetSession.mockReset();
  mockSignOut.mockReset();
  mockFindUserById.mockReset();

  mock.module("../../auth", () => ({
    auth: {
      api: {
        getSession: mockGetSession,
        signOut: mockSignOut,
      },
    },
  }));
  mock.module("@/db/repositories/user", () => ({
    findUserById: mockFindUserById,
  }));
  mock.module("@/db/repositories/account", () => ({
    findAccountByUserId: mock(),
  }));

  // dynamic import after mock.module so handler picks up the mocks
  const handlerModule = await import("../auth-handler");
  let captured: { verifySession?: VerifySessionFn } = {};
  const fakeRouter = {
    service: (_svc: unknown, impl: { verifySession: VerifySessionFn }) => {
      captured = impl;
    },
  };
  handlerModule.registerAuthService(
    fakeRouter as unknown as Parameters<typeof handlerModule.registerAuthService>[0],
  );
  if (!captured.verifySession) throw new Error("handler not captured");
  verifySession = captured.verifySession;
});

afterEach(() => {
  mock.restore();
});

afterAll(() => {
  mock.module("../../auth", () => realModules.auth);
  mock.module("@/db/repositories/user", () => realModules.userRepository);
  mock.module("@/db/repositories/account", () => realModules.accountRepository);
});

describe("verifySession outcome", () => {
  test("returns SESSION_NOT_FOUND when getSession returns null", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await verifySession({ sessionToken: "x" });
    expect(res.outcome.case).toBe("error");
    if (res.outcome.case !== "error") throw new Error();
    expect(res.outcome.value.reason).toBe(Result.SESSION_NOT_FOUND);
  });

  test("returns USER_DELETED when DB user is gone", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u1", revision: 0 },
      session: { id: "s1", expiresAt: new Date() },
    });
    mockFindUserById.mockResolvedValue(undefined);
    const res = await verifySession({ sessionToken: "x" });
    expect(res.outcome.case).toBe("error");
    if (res.outcome.case !== "error") throw new Error();
    expect(res.outcome.value.reason).toBe(Result.USER_DELETED);
  });

  test("returns REVISION_OUTDATED and calls signOut on revision mismatch", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u1", revision: 3 },
      session: { id: "s1", expiresAt: new Date() },
    });
    mockFindUserById.mockResolvedValue({
      id: "u1",
      name: "n",
      email: "e",
      emailVerified: true,
      image: null,
      revision: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockSignOut.mockResolvedValue(undefined);
    const res = await verifySession({ sessionToken: "x" });
    expect(res.outcome.case).toBe("error");
    if (res.outcome.case !== "error") throw new Error();
    expect(res.outcome.value.reason).toBe(Result.REVISION_OUTDATED);
    expect(mockSignOut).toHaveBeenCalled();
  });

  test("returns ok with user/session when revision matches", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u1", revision: 7 },
      session: { id: "s1", expiresAt: new Date("2030-01-01") },
    });
    mockFindUserById.mockResolvedValue({
      id: "u1",
      name: "n",
      email: "e",
      emailVerified: true,
      image: null,
      revision: 7,
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    });
    const res = await verifySession({ sessionToken: "x" });
    expect(res.outcome.case).toBe("ok");
    if (res.outcome.case !== "ok") throw new Error();
    expect(res.outcome.value.user?.id).toBe("u1");
    expect(res.outcome.value.user?.revision).toBe(7);
    expect(res.outcome.value.session?.sessionKind).toBe("user");
  });

  test("cached revision undefined → outcome.case === 'ok' (skips revision check)", async () => {
    mockGetSession.mockResolvedValue({
      // legacy session payload (deploy 前に発行されて revision フィールドがない)
      user: { id: "u1" },
      session: { id: "s1", expiresAt: new Date("2030-01-01") },
    });
    mockFindUserById.mockResolvedValue({
      id: "u1",
      name: "n",
      email: "e",
      emailVerified: true,
      image: null,
      revision: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await verifySession({ sessionToken: "x" });
    expect(res.outcome.case).toBe("ok");
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test("signOut throws → still returns REVISION_OUTDATED", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u1", revision: 3 },
      session: { id: "s1", expiresAt: new Date() },
    });
    mockFindUserById.mockResolvedValue({
      id: "u1",
      name: "n",
      email: "e",
      emailVerified: true,
      image: null,
      revision: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockSignOut.mockRejectedValue(new Error("redis down"));
    const warnSpy = mock();
    const originalWarn = console.warn;
    console.warn = warnSpy;
    try {
      const res = await verifySession({ sessionToken: "x" });
      expect(res.outcome.case).toBe("error");
      if (res.outcome.case !== "error") throw new Error();
      expect(res.outcome.value.reason).toBe(Result.REVISION_OUTDATED);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      console.warn = originalWarn;
    }
  });
});
