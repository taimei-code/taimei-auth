import { describe, expect, test } from "bun:test";
import type { MembershipRow, Role } from "@/db/repositories/membership";
import { type Actor, createMembershipGuard } from "../guard";

const ROLES: Role[] = ["OWNER", "ADMIN", "MEMBER"];

// guard が row から読むのは role のみなので、テストは role だけ持つ最小 fake で足りる。
const fakeMembership = (role: Role): MembershipRow => ({ role }) as unknown as MembershipRow;

const anActor: Actor = { id: "u_1", email: "a@example.com" };
const noHeaders = new Headers();

const buildGuard = (opts: { actor?: Actor | null; membershipRole?: Role | null }) =>
  createMembershipGuard({
    getActor: async () => opts.actor ?? null,
    findMembership: async () =>
      opts.membershipRole ? fakeMembership(opts.membershipRole) : undefined,
  });

describe("requireActor", () => {
  test("actor null → 401 unauthorized", async () => {
    const { requireActor } = buildGuard({ actor: null });
    expect(await requireActor(noHeaders)).toEqual({
      ok: false,
      error: "unauthorized",
      status: 401,
    });
  });

  test("actor 有り → ok + actor", async () => {
    const { requireActor } = buildGuard({ actor: anActor });
    expect(await requireActor(noHeaders)).toEqual({ ok: true, actor: anActor });
  });

  test("getActor が throw → 401 (fail-closed: 誤って通さず拒否)", async () => {
    const { requireActor } = createMembershipGuard({
      getActor: async () => {
        throw new Error("redis down");
      },
      findMembership: async () => undefined,
    });
    expect(await requireActor(noHeaders)).toEqual({
      ok: false,
      error: "unauthorized",
      status: 401,
    });
  });

  // async の rejection だけでなく、非 async の同期 throw も requireActor 側の .catch で 401 に落ちる。
  test("getActor が同期 throw (非 async) → 401 (fail-closed)", async () => {
    const { requireActor } = createMembershipGuard({
      getActor: () => {
        throw new Error("sync throw");
      },
      findMembership: async () => undefined,
    });
    expect(await requireActor(noHeaders)).toEqual({
      ok: false,
      error: "unauthorized",
      status: 401,
    });
  });
});

describe("requireMembershipOf", () => {
  test("非所属 → 403 forbidden", async () => {
    const { requireMembershipOf } = buildGuard({ membershipRole: null });
    expect(await requireMembershipOf(anActor, "co_1")).toEqual({
      ok: false,
      error: "forbidden",
      status: 403,
    });
  });

  test("所属あり minRole 省略 → ok (MEMBER でも通る)", async () => {
    const { requireMembershipOf } = buildGuard({ membershipRole: "MEMBER" });
    expect((await requireMembershipOf(anActor, "co_1")).ok).toBe(true);
  });

  test("MEMBER が ADMIN 要求 → 403", async () => {
    const { requireMembershipOf } = buildGuard({ membershipRole: "MEMBER" });
    expect((await requireMembershipOf(anActor, "co_1", "ADMIN")).ok).toBe(false);
  });

  test("ADMIN が ADMIN 要求 → ok", async () => {
    const { requireMembershipOf } = buildGuard({ membershipRole: "ADMIN" });
    expect((await requireMembershipOf(anActor, "co_1", "ADMIN")).ok).toBe(true);
  });

  test("ADMIN が OWNER 要求 → 403", async () => {
    const { requireMembershipOf } = buildGuard({ membershipRole: "ADMIN" });
    expect((await requireMembershipOf(anActor, "co_1", "OWNER")).ok).toBe(false);
  });

  test("OWNER は全 minRole を満たす", async () => {
    const { requireMembershipOf } = buildGuard({ membershipRole: "OWNER" });
    for (const minRole of ROLES) {
      expect((await requireMembershipOf(anActor, "co_1", minRole)).ok).toBe(true);
    }
  });

  // DB の role 列は text で ROLE_LEVEL に無い文字列が入りうる。minRole 比較時は fail-closed で 403、
  // minRole 省略時は role を見ない旧挙動 (members 一覧) を維持する。
  test("minRole 指定 + 想定外 role 文字列 → 403 (fail-closed)", async () => {
    const { requireMembershipOf } = buildGuard({ membershipRole: "SUPERVISOR" as Role });
    expect((await requireMembershipOf(anActor, "co_1", "MEMBER")).ok).toBe(false);
  });

  test("minRole 省略なら 想定外 role でも通る (旧挙動等価)", async () => {
    const { requireMembershipOf } = buildGuard({ membershipRole: "SUPERVISOR" as Role });
    expect((await requireMembershipOf(anActor, "co_1")).ok).toBe(true);
  });
});

describe("requireMembership (requireActor + requireMembershipOf の合成)", () => {
  test("未認証 → 401 (membership を問わない)", async () => {
    const { requireMembership } = buildGuard({ actor: null, membershipRole: "OWNER" });
    expect(await requireMembership(noHeaders, "co_1")).toEqual({
      ok: false,
      error: "unauthorized",
      status: 401,
    });
  });

  test("認証済・非所属 → 403 (requireMembershipOf に委譲)", async () => {
    const { requireMembership } = buildGuard({ actor: anActor, membershipRole: null });
    expect(await requireMembership(noHeaders, "co_1")).toEqual({
      ok: false,
      error: "forbidden",
      status: 403,
    });
  });

  test("認証済・minRole 不足 → 403", async () => {
    const { requireMembership } = buildGuard({ actor: anActor, membershipRole: "MEMBER" });
    expect((await requireMembership(noHeaders, "co_1", "ADMIN")).ok).toBe(false);
  });

  test("認証済・minRole 充足 → ok + actor + role", async () => {
    const { requireMembership } = buildGuard({ actor: anActor, membershipRole: "ADMIN" });
    const result = await requireMembership(noHeaders, "co_1", "ADMIN");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor).toEqual(anActor);
      expect(result.role).toBe("ADMIN");
    }
  });
});
