import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import type { UserRow } from "@/db/repositories/user";
import type { UserRepo } from "../../account/ports";
import type { Session } from "../../auth";
import type { AuthApi } from "../../auth-service";
import { AuthApiError } from "../../errors";
import type { MembershipRepo } from "../../membership/ports";
import {
  authFailing,
  type Membership,
  membershipRepoFailing,
  membershipRepoLayer,
  authLayer as sharedAuthLayer,
  userRepoLayer,
} from "../../membership/__tests__/test-layers";
import { type GetSessionResponse, Role as ProtoRole, Result } from "../../gen/auth/v1/auth_pb";
import { SentryLive } from "../../sentry";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { getSessionProgram } from "../auth-handler";

const mockSignOut = mock();

beforeEach(() => {
  mockSignOut.mockReset();
  mockSignOut.mockResolvedValue(undefined);
});

const signOut = () =>
  Effect.tryPromise({
    try: () => Promise.resolve(mockSignOut()),
    catch: (cause) => new AuthApiError({ cause }),
  });

const signedInWithRevision = (revision?: number): Layer.Layer<AuthApi> =>
  sharedAuthLayer(
    () =>
      ({
        user: { id: "u1", revision },
        session: { id: "s1", expiresAt: new Date("2030-01-01") },
      }) as unknown as Session,
    signOut,
  );

const userRow = (lastUsedCompanyId: string | null, revision = 7): UserRow =>
  ({
    id: "u1",
    name: "n",
    email: "e",
    emailVerified: true,
    image: null,
    revision,
    lastUsedCompanyId,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  }) as unknown as UserRow;

const runGetSession = (
  auth: Layer.Layer<AuthApi>,
  users: UserRow[],
  memberships: Layer.Layer<MembershipRepo>,
) =>
  Effect.runPromiseExit(
    Effect.provide(
      getSessionProgram({ sessionToken: "x" }),
      Layer.mergeAll(auth, userRepoLayer(users) as Layer.Layer<UserRepo>, memberships, SentryLive),
    ),
  );

type Outcome = GetSessionResponse["outcome"];

const outcomeOf = <C extends "ok" | "error">(
  exit: Exit.Exit<GetSessionResponse, unknown>,
  expected: C,
) => {
  if (!Exit.isSuccess(exit) || exit.value.outcome.case !== expected) {
    throw new Error(`not ${expected}`);
  }
  return exit.value.outcome.value as Extract<Outcome, { case: C }>["value"];
};

const okOf = async (lastUsedCompanyId: string | null, memberships: Layer.Layer<MembershipRepo>) =>
  outcomeOf(
    await runGetSession(signedInWithRevision(7), [userRow(lastUsedCompanyId)], memberships),
    "ok",
  );

const failsIfMembersAreRead = () => membershipRepoFailing(new Error("must not be read"));

const reasonOf = async (auth: Layer.Layer<AuthApi>, users: UserRow[]) =>
  outcomeOf(await runGetSession(auth, users, failsIfMembersAreRead()), "error").reason;

const membershipsOfC1AndC2: Membership[] = [
  { userId: "u1", companyId: "c1", role: "ADMIN", userName: "本人", userEmail: "u1@example.com" },
  { userId: "u2", companyId: "c1", role: "MEMBER", userName: "", userEmail: "u2@example.com" },
  { userId: "u3", companyId: "c2", role: "OWNER", userName: "他社", userEmail: "u3@example.com" },
];

describe("GetSession のセッションの判定", () => {
  const { exceptions: captured } = recordSentry();

  test("session が無ければ一覧を読まずに SESSION_NOT_FOUND を返す", async () => {
    expect(
      await reasonOf(
        sharedAuthLayer(() => null),
        [],
      ),
    ).toBe(Result.SESSION_NOT_FOUND);
  });

  test("user が消えていれば一覧を読まずに USER_DELETED を返す", async () => {
    expect(await reasonOf(signedInWithRevision(7), [])).toBe(Result.USER_DELETED);
  });

  test("revision が違えば一覧を読まずに REVISION_OUTDATED を返す", async () => {
    expect(await reasonOf(signedInWithRevision(3), [userRow("c1", 5)])).toBe(
      Result.REVISION_OUTDATED,
    );
  });

  test("revision が違えば signOut を 1 回呼ぶ", async () => {
    await reasonOf(signedInWithRevision(3), [userRow("c1", 5)]);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  test("revision 不一致の signOut が失敗しても REVISION_OUTDATED を返し、Sentry にはこの RPC の名前で送る", async () => {
    mockSignOut.mockRejectedValue(new Error("ttl store down"));
    const before = captured.length;

    expect(await reasonOf(signedInWithRevision(3), [userRow("c1", 5)])).toBe(
      Result.REVISION_OUTDATED,
    );
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]).toMatchObject({ tags: { handler: "getSession" } });
  });

  test("payload に revision が無ければ照合せずに ok を返す", async () => {
    const exit = await runGetSession(
      signedInWithRevision(undefined),
      [userRow("c1", 5)],
      membershipRepoLayer(membershipsOfC1AndC2),
    );
    expect(Exit.isSuccess(exit) && exit.value.outcome.case).toBe("ok");
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test("better-auth の getSession が失敗したら outcome を返さずに失敗する", async () => {
    const exit = await runGetSession(
      authFailing(new Error("auth down")),
      [userRow("c1")],
      membershipRepoLayer(membershipsOfC1AndC2),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("GetSession の現在の事業所と一覧", () => {
  test("現在の事業所が無ければ一覧を読まずに、default_company_id と current_role が空で members も空の ok を返す", async () => {
    const ok = await okOf(null, failsIfMembersAreRead());
    expect([ok.user?.defaultCompanyId, ok.currentRole, ok.members]).toEqual([
      undefined,
      undefined,
      [],
    ]);
  });

  test("一覧に本人がいなければ (user 行を読んだ後に除名された) current_role が空で members も空の ok を返す", async () => {
    const ok = await okOf(
      "c1",
      membershipRepoLayer(membershipsOfC1AndC2.filter((r) => r.userId !== "u1")),
    );
    expect([ok.currentRole, ok.members]).toEqual([undefined, []]);
  });

  test("本人がいれば current_role は本人の role で、members はその事業所の全員を 4 項目で返す", async () => {
    const ok = await okOf("c1", membershipRepoLayer(membershipsOfC1AndC2));
    expect(ok.currentRole).toBe(ProtoRole.ADMIN);
    expect(
      ok.members.map(({ userId, name, email, role }) => ({ userId, name, email, role })),
    ).toEqual([
      { userId: "u1", name: "本人", email: "u1@example.com", role: ProtoRole.ADMIN },
      { userId: "u2", name: "", email: "u2@example.com", role: ProtoRole.MEMBER },
    ]);
  });

  test("一覧の読み取りが失敗したら、ok を返さずに失敗する", async () => {
    const exit = await runGetSession(
      signedInWithRevision(7),
      [userRow("c1")],
      membershipRepoFailing(new Error("db down")),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
