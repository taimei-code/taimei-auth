import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { InvitationRow } from "@/db/repositories/invitation";
import { DbError } from "../../errors";
import {
  type Actor,
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
} from "./test-layers";

const actorOf = (id = "u1", email = "u1@example.com"): Actor => ({
  id,
  email,
  lastUsedCompanyId: null,
});

const actor = actorOf();

const members = (...rows: Array<[string, string, string]>) =>
  membershipRepoLayer(rows.map(([userId, companyId, role]) => ({ userId, companyId, role })));

describe("requireRoleChange (403 → 404 → 403)", () => {
  test("MEMBER (ADMIN 未満) → 403 (target 不在でも 404 に先立つ)", async () => {
    const e = await run(
      requireRoleChange({ actor, companyId: "c1", targetUserId: "t", nextRole: "ADMIN" }).pipe(
        Effect.provide(members(["u1", "c1", "MEMBER"])),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("ADMIN + target 不在 → 404", async () => {
    const e = await run(
      requireRoleChange({ actor, companyId: "c1", targetUserId: "t", nextRole: "ADMIN" }).pipe(
        Effect.provide(members(["u1", "c1", "ADMIN"])),
      ),
    );
    expect([e._tag, e.status]).toEqual(["NotFound", 404]);
  });

  test("ADMIN が OWNER に触れる変更 → 403 (canChangeRole)", async () => {
    const e = await run(
      requireRoleChange({ actor, companyId: "c1", targetUserId: "t", nextRole: "MEMBER" }).pipe(
        Effect.provide(members(["u1", "c1", "ADMIN"], ["t", "c1", "OWNER"])),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("ADMIN が MEMBER を ADMIN に → ok { actor, targetRole, nextRole }", async () => {
    const r = await runOk(
      requireRoleChange({ actor, companyId: "c1", targetUserId: "t", nextRole: "ADMIN" }).pipe(
        Effect.provide(members(["u1", "c1", "ADMIN"], ["t", "c1", "MEMBER"])),
      ),
    );
    expect(r).toMatchObject({ actor: { id: "u1" }, targetRole: "MEMBER", nextRole: "ADMIN" });
  });
});

describe("requireInvite (403 (ADMIN) → 403 (canInviteRole))", () => {
  test("QA-E-01 ADMIN + role=OWNER 招待 → 403 (canInviteRole)", async () => {
    const e = await run(
      requireInvite({ actor, companyId: "c1", body: { email: "x@x.jp", role: "OWNER" } }).pipe(
        Effect.provide(members(["u1", "c1", "ADMIN"])),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("MEMBER (ADMIN 未満) → 403", async () => {
    const e = await run(
      requireInvite({ actor, companyId: "c1", body: { email: "x@x.jp", role: "MEMBER" } }).pipe(
        Effect.provide(members(["u1", "c1", "MEMBER"])),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("ADMIN + role=MEMBER 招待 → ok { actor, email, role }", async () => {
    const r = await runOk(
      requireInvite({ actor, companyId: "c1", body: { email: "x@x.jp", role: "MEMBER" } }).pipe(
        Effect.provide(members(["u1", "c1", "ADMIN"])),
      ),
    );
    expect(r).toMatchObject({ actor: { id: "u1" }, email: "x@x.jp", role: "MEMBER" });
  });
});

describe("requireRemoval (403 (membership) → 403 (canAttemptRemoval) → 404 → 403 (canRemoveTarget))", () => {
  test("非所属 → 403 (canAttemptRemoval に先立つ)", async () => {
    const e = await run(
      requireRemoval({ actor, companyId: "c1", targetUserId: "t" }).pipe(Effect.provide(members())),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("MEMBER が他者除名 (isSelf=false, ADMIN 未満) → 403 (canAttemptRemoval)", async () => {
    const e = await run(
      requireRemoval({ actor, companyId: "c1", targetUserId: "t" }).pipe(
        Effect.provide(members(["u1", "c1", "MEMBER"], ["t", "c1", "MEMBER"])),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("ADMIN + target 不在 → 404", async () => {
    const e = await run(
      requireRemoval({ actor, companyId: "c1", targetUserId: "t" }).pipe(
        Effect.provide(members(["u1", "c1", "ADMIN"])),
      ),
    );
    expect(e._tag).toBe("NotFound");
  });

  test("ADMIN が他 OWNER 除名 → 403 (canRemoveTarget)", async () => {
    const e = await run(
      requireRemoval({ actor, companyId: "c1", targetUserId: "t" }).pipe(
        Effect.provide(members(["u1", "c1", "ADMIN"], ["t", "c1", "OWNER"])),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("MEMBER の自己離脱 → ok { isSelf: true }", async () => {
    const r = await runOk(
      requireRemoval({ actor, companyId: "c1", targetUserId: "u1" }).pipe(
        Effect.provide(members(["u1", "c1", "MEMBER"])),
      ),
    );
    expect(r).toMatchObject({ actor: { id: "u1" }, targetRole: "MEMBER", isSelf: true });
  });
});

describe("requireTransferOwnership (400 self → 403 → 404 → 400 already_owner)", () => {
  test("self 委譲 → 400 invalid_argument", async () => {
    const e = await run(
      requireTransferOwnership({ actor, companyId: "c1", toUserId: "u1" }).pipe(
        Effect.provide(members(["u1", "c1", "OWNER"])),
      ),
    );
    expect([e._tag, e.status]).toEqual(["InvalidArgument", 400]);
  });

  test("非 OWNER の self 委譲 → 403 に先立って 400 invalid_argument", async () => {
    const e = await run(
      requireTransferOwnership({ actor, companyId: "c1", toUserId: "u1" }).pipe(
        Effect.provide(members(["u1", "c1", "MEMBER"])),
      ),
    );
    expect([e._tag, e.status]).toEqual(["InvalidArgument", 400]);
  });

  test("非 OWNER → 403", async () => {
    const e = await run(
      requireTransferOwnership({ actor, companyId: "c1", toUserId: "t" }).pipe(
        Effect.provide(members(["u1", "c1", "ADMIN"])),
      ),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("target 不在 → 404", async () => {
    const e = await run(
      requireTransferOwnership({ actor, companyId: "c1", toUserId: "t" }).pipe(
        Effect.provide(members(["u1", "c1", "OWNER"])),
      ),
    );
    expect(e._tag).toBe("NotFound");
  });

  test("target 既に OWNER → 400 already_owner", async () => {
    const e = await run(
      requireTransferOwnership({ actor, companyId: "c1", toUserId: "t" }).pipe(
        Effect.provide(members(["u1", "c1", "OWNER"], ["t", "c1", "OWNER"])),
      ),
    );
    expect([e._tag, e.error, e.status]).toEqual(["AlreadyOwner", "already_owner", 400]);
  });

  test("OWNER が MEMBER へ委譲 → ok { actor, toUserId }", async () => {
    const r = await runOk(
      requireTransferOwnership({ actor, companyId: "c1", toUserId: "t" }).pipe(
        Effect.provide(members(["u1", "c1", "OWNER"], ["t", "c1", "MEMBER"])),
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

describe("requireInvitationAccept (404 (token) → 403 (email) → reused → 410)", () => {
  const accept = (token: string, who: Actor = actor) =>
    requireInvitationAccept({ actor: who, token });

  test("token 不在 → 404", async () => {
    const e = await run(
      accept("nope").pipe(Effect.provide(Layer.mergeAll(members(), invitationRepoLayer([])))),
    );
    expect(e._tag).toBe("NotFound");
  });

  test("token を持っていても招待先と別の email の人は受諾できない → 403 email_mismatch (大文字小文字は区別しない)", async () => {
    const layer = Layer.mergeAll(
      members(),
      invitationRepoLayer([invitationOf({ email: "other@example.com" })]),
    );
    const e = await run(accept("tok", actorOf("u1", "U1@example.com")).pipe(Effect.provide(layer)));
    expect([e._tag, e.error, e.status]).toEqual(["EmailMismatch", "email_mismatch", 403]);
  });

  test("email が大文字小文字だけ違う → 一致とみなし先へ進む", async () => {
    const layer = Layer.mergeAll(
      members(["u1", "c1", "MEMBER"]),
      invitationRepoLayer([invitationOf({})]),
    );
    const r = await runOk(
      accept("tok", actorOf("u1", "U1@EXAMPLE.com")).pipe(Effect.provide(layer)),
    );
    expect(r).toEqual({ mode: "reused", companyId: "c1" });
  });

  test("既所属短絡 (期限切れ invitation でも既所属なら reused=200) — QA-M-01 の contract", async () => {
    const expired = invitationOf({ expiresAt: new Date(Date.now() - 60_000) });
    const layer = Layer.mergeAll(members(["u1", "c1", "MEMBER"]), invitationRepoLayer([expired]));
    const r = await runOk(accept("tok").pipe(Effect.provide(layer)));
    expect(r).toEqual({ mode: "reused", companyId: "c1" });
  });

  test("期限切れ + 未所属 → 410 (isAcceptable の最後)", async () => {
    const expired = invitationOf({ expiresAt: new Date(Date.now() - 60_000) });
    const layer = Layer.mergeAll(members(), invitationRepoLayer([expired]));
    const e = await run(accept("tok").pipe(Effect.provide(layer)));
    expect([e._tag, e.status]).toEqual(["ExpiredOrUsed", 410]);
  });

  test("valid + 未所属 → proceed", async () => {
    const inv = invitationOf({});
    const layer = Layer.mergeAll(members(), invitationRepoLayer([inv]));
    const r = await runOk(accept("tok").pipe(Effect.provide(layer)));
    expect(r).toMatchObject({ mode: "proceed", actor: { id: "u1" }, invitation: inv });
  });
});

describe("QA-R-05 MembershipRepo の DbError は伝播する (fail-closed の対象は session のみ)", () => {
  test("operation 単位 entry も DbError を捕捉しない", async () => {
    const cause = new Error("db timeout");
    const e = await run(
      requireRemoval({ actor, companyId: "c1", targetUserId: "t" }).pipe(
        Effect.provide(membershipRepoFailing(cause)),
      ),
    );
    expect(e).toBeInstanceOf(DbError);
    expect((e as DbError).cause).toBe(cause);
  });
});
