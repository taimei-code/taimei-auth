import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { UserRow } from "@/db/repositories/user";
import { SessionRepo, UserRepo } from "../../account/ports";
import type { Session } from "../../auth";
import { AuthApi } from "../../auth-service";
import { AuthApiError } from "../../errors";
import {
  authLayer as sharedAuthLayer,
  userRepoLayer,
} from "../../membership/__tests__/test-layers";
import { Result, type VerifySessionResponse } from "../../gen/auth/v1/auth_pb";
import { SentryLive } from "../../sentry";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { verifySessionProgram } from "../auth-handler";

// better-auth (getSession / signOut) と DB (UserRepo / SessionRepo) はすべて test Layer で差し替える
// (mock.module はプロセス全体に作用して後続のファイルに漏れるため使わない)。
const mockSignOut = mock();

beforeEach(() => {
  mockSignOut.mockReset();
});

// 共有 authLayer の signOut を mock に差し替える (既定は Effect.void)。
const signOut = () =>
  Effect.tryPromise({
    try: () => Promise.resolve(mockSignOut()),
    catch: (cause) => new AuthApiError({ cause }),
  });

const authLayer = (getSession: () => Session | null): Layer.Layer<AuthApi> =>
  sharedAuthLayer(getSession, signOut);

const sessionOf = (user: Record<string, unknown> | undefined, sessionId = "s1"): Session =>
  ({
    user,
    session: { id: sessionId, expiresAt: new Date("2030-01-01") },
  }) as unknown as Session;

const userRow = (revision: number): UserRow =>
  ({
    id: "u1",
    name: "n",
    email: "e",
    emailVerified: true,
    image: null,
    revision,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  }) as unknown as UserRow;

const sessionRepoLayer = (revokedAt: Date | null): Layer.Layer<SessionRepo> =>
  Layer.succeed(SessionRepo, {
    findSessionRevokedAt: () => Effect.succeed(revokedAt),
  } as unknown as SessionRepo["Service"]);

const run = (
  layers: Layer.Layer<AuthApi | UserRepo | SessionRepo>,
): Promise<VerifySessionResponse> =>
  Effect.runPromise(
    Effect.provide(verifySessionProgram({ sessionToken: "x" }), Layer.mergeAll(layers, SentryLive)),
  );

describe("verifySession outcome", () => {
  const captured = recordSentryExceptions();
  test("returns SESSION_NOT_FOUND when getSession returns null", async () => {
    const res = await run(
      Layer.mergeAll(
        authLayer(() => null),
        userRepoLayer([]),
        sessionRepoLayer(null),
      ),
    );
    expect(res.outcome.case).toBe("error");
    if (res.outcome.case !== "error") throw new Error();
    expect(res.outcome.value.reason).toBe(Result.SESSION_NOT_FOUND);
  });

  test("returns USER_DELETED when DB user is gone", async () => {
    const res = await run(
      Layer.mergeAll(
        authLayer(() => sessionOf({ id: "u1", revision: 0 })),
        userRepoLayer([]),
        sessionRepoLayer(null),
      ),
    );
    expect(res.outcome.case).toBe("error");
    if (res.outcome.case !== "error") throw new Error();
    expect(res.outcome.value.reason).toBe(Result.USER_DELETED);
  });

  test("returns REVOKED when the session row is revoked", async () => {
    const res = await run(
      Layer.mergeAll(
        authLayer(() => sessionOf({ id: "u1", revision: 5 })),
        userRepoLayer([userRow(5)]),
        sessionRepoLayer(new Date("2025-01-01")),
      ),
    );
    expect(res.outcome.case).toBe("error");
    if (res.outcome.case !== "error") throw new Error();
    expect(res.outcome.value.reason).toBe(Result.REVOKED);
  });

  test("returns REVISION_OUTDATED and calls signOut on revision mismatch", async () => {
    mockSignOut.mockResolvedValue(undefined);
    const res = await run(
      Layer.mergeAll(
        authLayer(() => sessionOf({ id: "u1", revision: 3 })),
        userRepoLayer([userRow(5)]),
        sessionRepoLayer(null),
      ),
    );
    expect(res.outcome.case).toBe("error");
    if (res.outcome.case !== "error") throw new Error();
    expect(res.outcome.value.reason).toBe(Result.REVISION_OUTDATED);
    expect(mockSignOut).toHaveBeenCalled();
  });

  test("returns ok with user/session when revision matches", async () => {
    const res = await run(
      Layer.mergeAll(
        authLayer(() => sessionOf({ id: "u1", revision: 7 })),
        userRepoLayer([userRow(7)]),
        sessionRepoLayer(null),
      ),
    );
    expect(res.outcome.case).toBe("ok");
    if (res.outcome.case !== "ok") throw new Error();
    expect(res.outcome.value.user?.id).toBe("u1");
    expect(res.outcome.value.user?.revision).toBe(7);
    expect(res.outcome.value.session?.sessionKind).toBe("user");
  });

  test("cached revision undefined → outcome.case === 'ok' (skips revision check)", async () => {
    // 旧形式の session payload (deploy 前に発行されたため revision フィールドがない)
    const res = await run(
      Layer.mergeAll(
        authLayer(() => sessionOf({ id: "u1" })),
        userRepoLayer([userRow(5)]),
        sessionRepoLayer(null),
      ),
    );
    expect(res.outcome.case).toBe("ok");
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test("AC-017/018 signOut throws → still returns REVISION_OUTDATED and records the cause to Sentry", async () => {
    const cause = new Error("ttl store down");
    mockSignOut.mockRejectedValue(cause);
    const before = captured.length;
    const res = await run(
      Layer.mergeAll(
        authLayer(() => sessionOf({ id: "u1", revision: 3 })),
        userRepoLayer([userRow(5)]),
        sessionRepoLayer(null),
      ),
    );
    expect(res.outcome.case).toBe("error");
    if (res.outcome.case !== "error") throw new Error();
    expect(res.outcome.value.reason).toBe(Result.REVISION_OUTDATED);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[0]).toBe(cause);
    expect(captured.at(-1)?.[1]).toMatchObject({
      level: "warning",
      tags: { handler: "verifySession" },
    });
  });
});
