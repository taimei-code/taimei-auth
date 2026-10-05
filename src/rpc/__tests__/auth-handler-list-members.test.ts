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
import {
  type ListCurrentCompanyMembersResponse,
  Role as ProtoRole,
  Result,
} from "../../gen/auth/v1/auth_pb";
import { SentryLive } from "../../sentry";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { listCurrentCompanyMembersProgram } from "../auth-handler";

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
  ({ id: "u1", revision, lastUsedCompanyId }) as unknown as UserRow;

const runListMembers = (
  auth: Layer.Layer<AuthApi>,
  users: UserRow[],
  memberships: Layer.Layer<MembershipRepo>,
) =>
  Effect.runPromiseExit(
    Effect.provide(
      listCurrentCompanyMembersProgram({ sessionToken: "x" }),
      Layer.mergeAll(auth, userRepoLayer(users) as Layer.Layer<UserRepo>, memberships, SentryLive),
    ),
  );

type Outcome = ListCurrentCompanyMembersResponse["outcome"];

const outcomeOf = <C extends "ok" | "error">(
  exit: Exit.Exit<ListCurrentCompanyMembersResponse, unknown>,
  expected: C,
) => {
  if (!Exit.isSuccess(exit) || exit.value.outcome.case !== expected) {
    throw new Error(`not ${expected}`);
  }
  return exit.value.outcome.value as Extract<Outcome, { case: C }>["value"];
};

const okOf = async (lastUsedCompanyId: string | null, memberships: Layer.Layer<MembershipRepo>) =>
  outcomeOf(
    await runListMembers(signedInWithRevision(7), [userRow(lastUsedCompanyId)], memberships),
    "ok",
  );

const failsIfMembersAreRead = () => membershipRepoFailing(new Error("must not be read"));

const reasonOf = async (auth: Layer.Layer<AuthApi>, users: UserRow[]) =>
  outcomeOf(await runListMembers(auth, users, failsIfMembersAreRead()), "error").reason;

const membershipsOfC1AndC2: Membership[] = [
  { userId: "u1", companyId: "c1", role: "ADMIN", userName: "本人", userEmail: "u1@example.com" },
  { userId: "u2", companyId: "c1", role: "MEMBER", userName: "", userEmail: "u2@example.com" },
  { userId: "u3", companyId: "c2", role: "OWNER", userName: "他社", userEmail: "u3@example.com" },
];

describe("ListCurrentCompanyMembers の一覧", () => {
  test("AC-001/004/007: 本人を含む一覧は 4 項目で全員を返し (空の name はそのまま)、company_id はその事業所", async () => {
    const ok = await okOf("c1", membershipRepoLayer(membershipsOfC1AndC2));
    expect(ok.companyId).toBe("c1");
    expect(
      ok.members.map(({ userId, name, email, role }) => ({ userId, name, email, role })),
    ).toEqual([
      { userId: "u1", name: "本人", email: "u1@example.com", role: ProtoRole.ADMIN },
      { userId: "u2", name: "", email: "u2@example.com", role: ProtoRole.MEMBER },
    ]);
  });

  test("AC-046: members は加入の古い順で、加入日時が同じ人は membership の ID 順", async () => {
    const at = (day: number) => new Date(Date.UTC(2026, 0, day));
    const ok = await okOf(
      "c1",
      membershipRepoLayer([
        { userId: "u1", companyId: "c1", role: "OWNER", joinedAt: at(3) },
        { userId: "u3", companyId: "c1", role: "MEMBER", joinedAt: at(1) },
        { userId: "u2", companyId: "c1", role: "MEMBER", joinedAt: at(1) },
      ]),
    );
    expect(ok.members.map((m) => m.userId)).toEqual(["u2", "u3", "u1"]);
  });

  test("AC-005: 現在の事業所が無ければ一覧を読まずに空の ok を返す", async () => {
    const ok = await okOf(null, failsIfMembersAreRead());
    expect([ok.companyId, ok.members]).toEqual([undefined, []]);
  });

  test("AC-006: 一覧に本人がいなければ (user 行を読んだ後に除名された) 空の ok を返す", async () => {
    const ok = await okOf(
      "c1",
      membershipRepoLayer(membershipsOfC1AndC2.filter((r) => r.userId !== "u1")),
    );
    expect([ok.companyId, ok.members]).toEqual([undefined, []]);
  });

  test("AC-012: 一覧の読み取りが失敗したら空の ok に縮退せず失敗する", async () => {
    const exit = await runListMembers(
      signedInWithRevision(7),
      [userRow("c1")],
      membershipRepoFailing(new Error("db down")),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("ListCurrentCompanyMembers のセッションの判定", () => {
  const captured = recordSentryExceptions();

  test("revision 不一致の signOut が失敗しても REVISION_OUTDATED を返し、Sentry にはこの RPC の名前で送る", async () => {
    const cause = new Error("ttl store down");
    mockSignOut.mockRejectedValue(cause);
    const before = captured.length;

    expect(await reasonOf(signedInWithRevision(3), [userRow("c1", 5)])).toBe(
      Result.REVISION_OUTDATED,
    );
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]).toMatchObject({ tags: { handler: "listCurrentCompanyMembers" } });
  });

  test("AC-008: session が無ければ SESSION_NOT_FOUND", async () => {
    expect(
      await reasonOf(
        sharedAuthLayer(() => null),
        [],
      ),
    ).toBe(Result.SESSION_NOT_FOUND);
  });

  test("AC-009: user が消えていれば USER_DELETED", async () => {
    expect(await reasonOf(signedInWithRevision(7), [])).toBe(Result.USER_DELETED);
  });

  test("AC-010: revision が違えば signOut して REVISION_OUTDATED", async () => {
    expect(await reasonOf(signedInWithRevision(3), [userRow("c1", 5)])).toBe(
      Result.REVISION_OUTDATED,
    );
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  test("AC-011: payload に revision が無ければ照合せずに ok を返す", async () => {
    const exit = await runListMembers(
      signedInWithRevision(undefined),
      [userRow("c1", 5)],
      membershipRepoLayer(membershipsOfC1AndC2),
    );
    expect(Exit.isSuccess(exit) && exit.value.outcome.case).toBe("ok");
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test("AC-038: getSession が失敗したら outcome を返さずに失敗する", async () => {
    const exit = await runListMembers(
      authFailing(new Error("auth down")),
      [userRow("c1")],
      membershipRepoLayer(membershipsOfC1AndC2),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
