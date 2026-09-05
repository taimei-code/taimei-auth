import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { InvitationRow } from "@/db/repositories/invitation";
import { DbError } from "../../errors";
import { InvalidArgument } from "../guard/errors";
import {
  type ParseBody,
  requireInvitationAccept,
  requireInvite,
  requireRemoval,
  requireRoleChange,
  requireTransferOwnership,
} from "../guard";
import {
  invitationRepoLayer,
  membershipRepoFailing,
  membershipRepoLayer,
  run,
  runOk,
  signedIn,
  signedOut,
} from "./test-layers";

// 旧 guard-entries.test.ts (22 test) との対応表 (AC-036): describe / test 名を同じ順序で維持し、
// deps factory → test Layer、Result object → Effect.flip で取り出した failure class に置き換えた。
// parseBody は Effect (lazy) を渡し、呼ばれたかどうかを parseCalls で数える (短絡の pin)。

const headers = new Headers();

const parser = <T>(result: { ok: true; data: T } | { ok: false; details?: unknown }) => {
  const calls = { n: 0 };
  const parseBody: ParseBody<T> = Effect.suspend(() => {
    calls.n += 1;
    return result.ok
      ? Effect.succeed(result.data)
      : Effect.fail(
          new InvalidArgument(result.details === undefined ? {} : { details: result.details }),
        );
  });
  return { parseBody, calls };
};

const members = (...rows: Array<[string, string, string]>) =>
  membershipRepoLayer(rows.map(([userId, companyId, role]) => ({ userId, companyId, role })));

describe("requireRoleChange (401 → 400 → 403 → 404 → 403)", () => {
  test("QA-D-01 未認証 + invalid body → 401 (400 に先立つ、parse 未実行)", async () => {
    const { parseBody, calls } = parser<{ nextRole: "ADMIN" }>({ ok: false });
    const e = await run(
      requireRoleChange({ headers, companyId: "c1", targetUserId: "t", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedOut(), members())),
      ),
    );
    expect([e._tag, calls.n]).toEqual(["Unauthorized", 0]);
  });

  test("認証済 + invalid body → 400 (403/404 に先立つ)", async () => {
    const { parseBody, calls } = parser<{ nextRole: "ADMIN" }>({ ok: false });
    const e = await run(
      requireRoleChange({ headers, companyId: "c1", targetUserId: "t", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members())),
      ),
    );
    expect([e._tag, e.status, calls.n]).toEqual(["InvalidArgument", 400, 1]);
  });

  test("認証済 + valid body + MEMBER (ADMIN 未満) → 403", async () => {
    const { parseBody } = parser({ ok: true, data: { nextRole: "ADMIN" as const } });
    const e = await run(
      requireRoleChange({ headers, companyId: "c1", targetUserId: "t", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "MEMBER"]))),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("ADMIN + target 不在 → 404", async () => {
    const { parseBody } = parser({ ok: true, data: { nextRole: "ADMIN" as const } });
    const e = await run(
      requireRoleChange({ headers, companyId: "c1", targetUserId: "t", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "ADMIN"]))),
      ),
    );
    expect([e._tag, e.status]).toEqual(["NotFound", 404]);
  });

  test("ADMIN が OWNER に触れる変更 → 403 (canChangeRole)", async () => {
    const { parseBody } = parser({ ok: true, data: { nextRole: "MEMBER" as const } });
    const e = await run(
      requireRoleChange({ headers, companyId: "c1", targetUserId: "t", parseBody }).pipe(
        Effect.provide(
          Layer.mergeAll(signedIn(), members(["u1", "c1", "ADMIN"], ["t", "c1", "OWNER"])),
        ),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("ADMIN が MEMBER を ADMIN に → ok { actor, targetRole, nextRole }", async () => {
    const { parseBody } = parser({ ok: true, data: { nextRole: "ADMIN" as const } });
    const r = await runOk(
      requireRoleChange({ headers, companyId: "c1", targetUserId: "t", parseBody }).pipe(
        Effect.provide(
          Layer.mergeAll(signedIn(), members(["u1", "c1", "ADMIN"], ["t", "c1", "MEMBER"])),
        ),
      ),
    );
    expect(r).toMatchObject({ actor: { id: "u1" }, targetRole: "MEMBER", nextRole: "ADMIN" });
  });
});

describe("requireInvite (401 → 403 (ADMIN) → 400 → 403 (canInviteRole))", () => {
  test("QA-E-01 ADMIN + role=OWNER 招待 → 403 (canInviteRole)", async () => {
    const { parseBody } = parser({ ok: true, data: { email: "x@x.jp", role: "OWNER" as const } });
    const e = await run(
      requireInvite({ headers, companyId: "c1", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "ADMIN"]))),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("MEMBER (ADMIN 未満) → 400 に先立って 403 (parse 未実行)", async () => {
    const { parseBody, calls } = parser<{ email: string; role: "MEMBER" }>({
      ok: false,
      details: { x: 1 },
    });
    const e = await run(
      requireInvite({ headers, companyId: "c1", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "MEMBER"]))),
      ),
    );
    expect([e._tag, calls.n]).toEqual(["Forbidden", 0]);
  });

  test("ADMIN + invalid body → 400 with details", async () => {
    const details = { formErrors: [], fieldErrors: { email: ["Invalid email address"] } };
    const { parseBody } = parser<{ email: string; role: "MEMBER" }>({ ok: false, details });
    const e = await run(
      requireInvite({ headers, companyId: "c1", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "ADMIN"]))),
      ),
    );
    expect(e).toBeInstanceOf(InvalidArgument);
    expect((e as InvalidArgument).details).toBe(details);
  });

  test("ADMIN + role=MEMBER 招待 → ok { actor, email, role }", async () => {
    const { parseBody } = parser({ ok: true, data: { email: "x@x.jp", role: "MEMBER" as const } });
    const r = await runOk(
      requireInvite({ headers, companyId: "c1", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "ADMIN"]))),
      ),
    );
    expect(r).toMatchObject({ actor: { id: "u1" }, email: "x@x.jp", role: "MEMBER" });
  });
});

describe("requireRemoval (401 → 403 (membership) → 403 (canAttemptRemoval) → 404 → 403 (canRemoveTarget))", () => {
  test("非所属 → 403 (canAttemptRemoval に先立つ)", async () => {
    const e = await run(
      requireRemoval({ headers, companyId: "c1", targetUserId: "t" }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members())),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("MEMBER が他者除名 (isSelf=false, ADMIN 未満) → 403 (canAttemptRemoval)", async () => {
    const e = await run(
      requireRemoval({ headers, companyId: "c1", targetUserId: "t" }).pipe(
        Effect.provide(
          Layer.mergeAll(signedIn(), members(["u1", "c1", "MEMBER"], ["t", "c1", "MEMBER"])),
        ),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("ADMIN + target 不在 → 404", async () => {
    const e = await run(
      requireRemoval({ headers, companyId: "c1", targetUserId: "t" }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "ADMIN"]))),
      ),
    );
    expect(e._tag).toBe("NotFound");
  });

  test("ADMIN が他 OWNER 除名 → 403 (canRemoveTarget)", async () => {
    const e = await run(
      requireRemoval({ headers, companyId: "c1", targetUserId: "t" }).pipe(
        Effect.provide(
          Layer.mergeAll(signedIn(), members(["u1", "c1", "ADMIN"], ["t", "c1", "OWNER"])),
        ),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("MEMBER の自己離脱 → ok { isSelf: true }", async () => {
    const r = await runOk(
      requireRemoval({ headers, companyId: "c1", targetUserId: "u1" }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "MEMBER"]))),
      ),
    );
    expect(r).toMatchObject({ actor: { id: "u1" }, targetRole: "MEMBER", isSelf: true });
  });
});

describe("requireTransferOwnership (401 → 400 → 403 → 404 → 400 already_owner)", () => {
  test("認証済 + self 委譲 → 400 invalid_argument (parseBody 段で self 検知)", async () => {
    const { parseBody } = parser({ ok: true, data: { toUserId: "u1" } });
    const e = await run(
      requireTransferOwnership({ headers, companyId: "c1", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "OWNER"]))),
      ),
    );
    expect([e._tag, e.status]).toEqual(["InvalidArgument", 400]);
  });

  test("非 OWNER → 403", async () => {
    const { parseBody } = parser({ ok: true, data: { toUserId: "t" } });
    const e = await run(
      requireTransferOwnership({ headers, companyId: "c1", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "ADMIN"]))),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("target 不在 → 404", async () => {
    const { parseBody } = parser({ ok: true, data: { toUserId: "t" } });
    const e = await run(
      requireTransferOwnership({ headers, companyId: "c1", parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(["u1", "c1", "OWNER"]))),
      ),
    );
    expect(e._tag).toBe("NotFound");
  });

  test("target 既に OWNER → 400 already_owner", async () => {
    const { parseBody } = parser({ ok: true, data: { toUserId: "t" } });
    const e = await run(
      requireTransferOwnership({ headers, companyId: "c1", parseBody }).pipe(
        Effect.provide(
          Layer.mergeAll(signedIn(), members(["u1", "c1", "OWNER"], ["t", "c1", "OWNER"])),
        ),
      ),
    );
    expect([e._tag, e.error, e.status]).toEqual(["AlreadyOwner", "already_owner", 400]);
  });

  test("OWNER が MEMBER へ委譲 → ok { actor, toUserId }", async () => {
    const { parseBody } = parser({ ok: true, data: { toUserId: "t" } });
    const r = await runOk(
      requireTransferOwnership({ headers, companyId: "c1", parseBody }).pipe(
        Effect.provide(
          Layer.mergeAll(signedIn(), members(["u1", "c1", "OWNER"], ["t", "c1", "MEMBER"])),
        ),
      ),
    );
    expect(r).toMatchObject({ actor: { id: "u1" }, toUserId: "t" });
  });
});

const invitationOf = (over: Partial<InvitationRow>): InvitationRow =>
  ({
    id: "inv1",
    token: "tok",
    email: "u1@example.com",
    companyId: "c1",
    role: "MEMBER",
    invitedByUserId: "owner",
    status: "PENDING",
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    revokedAt: null,
    ...over,
  }) as InvitationRow;

describe("requireInvitationAccept (401 → 400 → 404 (token) → 403 (email) → reused → 410)", () => {
  const accept = (token: string) => {
    const { parseBody } = parser({ ok: true, data: { token } });
    return requireInvitationAccept({ headers, parseBody });
  };

  test("未認証 → 401 (parse 未実行)", async () => {
    const { parseBody, calls } = parser<{ token: string }>({ ok: false });
    const e = await run(
      requireInvitationAccept({ headers, parseBody }).pipe(
        Effect.provide(Layer.mergeAll(signedOut(), members(), invitationRepoLayer([]))),
      ),
    );
    expect([e._tag, calls.n]).toEqual(["Unauthorized", 0]);
  });

  test("token 不在 → 404", async () => {
    const e = await run(
      accept("nope").pipe(
        Effect.provide(Layer.mergeAll(signedIn(), members(), invitationRepoLayer([]))),
      ),
    );
    expect(e._tag).toBe("NotFound");
  });

  test("email 不一致 → 403 email_mismatch (case-insensitive で差があると発火)", async () => {
    const layer = Layer.mergeAll(
      signedIn("u1", "U1@example.com"),
      members(),
      invitationRepoLayer([invitationOf({ email: "other@example.com" })]),
    );
    const e = await run(accept("tok").pipe(Effect.provide(layer)));
    expect([e._tag, e.error, e.status]).toEqual(["EmailMismatch", "email_mismatch", 403]);
  });

  test("email が大文字小文字だけ違う → 一致とみなし先へ進む", async () => {
    const layer = Layer.mergeAll(
      signedIn("u1", "U1@EXAMPLE.com"),
      members(["u1", "c1", "MEMBER"]),
      invitationRepoLayer([invitationOf({})]),
    );
    const r = await runOk(accept("tok").pipe(Effect.provide(layer)));
    expect(r).toEqual({ mode: "reused", companyId: "c1" });
  });

  test("既所属短絡 (期限切れ invitation でも既所属なら reused=200) — QA-M-01 の contract", async () => {
    const expired = invitationOf({ expiresAt: new Date(Date.now() - 60_000) });
    const layer = Layer.mergeAll(
      signedIn(),
      members(["u1", "c1", "MEMBER"]),
      invitationRepoLayer([expired]),
    );
    const r = await runOk(accept("tok").pipe(Effect.provide(layer)));
    expect(r).toEqual({ mode: "reused", companyId: "c1" });
  });

  test("期限切れ + 未所属 → 410 (isAcceptable の最後)", async () => {
    const expired = invitationOf({ expiresAt: new Date(Date.now() - 60_000) });
    const layer = Layer.mergeAll(signedIn(), members(), invitationRepoLayer([expired]));
    const e = await run(accept("tok").pipe(Effect.provide(layer)));
    expect([e._tag, e.status]).toEqual(["ExpiredOrUsed", 410]);
  });

  test("valid + 未所属 → proceed", async () => {
    const inv = invitationOf({});
    const layer = Layer.mergeAll(signedIn(), members(), invitationRepoLayer([inv]));
    const r = await runOk(accept("tok").pipe(Effect.provide(layer)));
    expect(r).toMatchObject({ mode: "proceed", actor: { id: "u1" }, invitation: inv });
  });
});

describe("QA-R-05 MembershipRepo の DbError は伝播する (fail-closed の対象は session のみ)", () => {
  test("operation 単位 entry も DbError を捕捉しない", async () => {
    const cause = new Error("db timeout");
    const e = await run(
      requireRemoval({ headers, companyId: "c1", targetUserId: "t" }).pipe(
        Effect.provide(Layer.mergeAll(signedIn(), membershipRepoFailing(cause))),
      ),
    );
    expect(e).toBeInstanceOf(DbError);
    expect((e as DbError).cause).toBe(cause);
  });
});
