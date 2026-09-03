import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { MembershipRow, Role } from "@/db/repositories/membership";
import { type CaptureContext, setSentryBackend } from "../../sentry";
import {
  type Actor,
  createMembershipGuard,
  makeRequireInvite,
  makeRequireRoleChange,
  resolveParseBody,
} from "../guard";

// 案 E1 prototype (Effect v4) で Guard 層の内部合成を Effect program に置き換えた際に、Transport との
// 既存契約 (Promise<Result>、失敗 object の形、defect の伝播) が変わっていないことを固定する。
// 判定順そのものは guard.test.ts / guard-entries.test.ts が DI で覆う (本 file は差分の pin に絞る)。

const anActor: Actor = { id: "u_1", email: "a@example.com", lastUsedCompanyId: null };
const noHeaders = new Headers();
const fakeMembership = (role: Role): MembershipRow => ({ role }) as unknown as MembershipRow;

const buildGuard = (opts: { actor?: Actor | null; membershipRole?: Role | null }) =>
  createMembershipGuard({
    getActor: async () => opts.actor ?? null,
    findMembership: async () =>
      opts.membershipRole ? fakeMembership(opts.membershipRole) : undefined,
  });

type CapturedException = { error: unknown; context?: CaptureContext };
let capturedExceptions: CapturedException[] = [];
beforeEach(() => {
  capturedExceptions = [];
  setSentryBackend({
    captureException: (error, context) => {
      capturedExceptions.push({ error, context });
    },
    captureMessage: () => {},
  });
});
afterAll(() => {
  setSentryBackend({
    captureException: (error) => console.error("[sentry:noop] captureException", error),
    captureMessage: (message, context) =>
      console.warn("[sentry:noop] captureMessage", message, context?.tags),
  });
});

describe("Effect defect は元の Error のまま Promise 境界を抜ける", () => {
  // QA-R-05 の強化: toThrow(message) の部分一致ではなく object identity で pin する。Hono onError → Sentry が
  // 受け取る error が FiberFailure 等の wrapper に変わると Sentry の grouping / fingerprint が変わるため。
  test("findMembership の throw は wrapper なしで同一 object が reject される", async () => {
    const failure = new Error("db timeout");
    const { requireMembership } = createMembershipGuard({
      getActor: async () => anActor,
      findMembership: async () => {
        throw failure;
      },
    });
    await expect(requireMembership(noHeaders, "co_1")).rejects.toBe(failure);
  });

  test("operation entry の findMembership throw も同一 object が reject される", async () => {
    const failure = new Error("db timeout");
    const entry = makeRequireRoleChange({
      guard: buildGuard({ actor: anActor, membershipRole: "ADMIN" }),
      findMembership: async () => {
        throw failure;
      },
    });
    await expect(
      entry({
        headers: noHeaders,
        companyId: "co_1",
        targetUserId: "u_2",
        parseBody: () => ({ ok: true, data: { nextRole: "MEMBER" } }),
      }),
    ).rejects.toBe(failure);
  });

  test("parseBody callback の throw も捕捉せず同一 object が reject される (400 に化けない)", async () => {
    const failure = new Error("body stream broken");
    const entry = makeRequireRoleChange({
      guard: buildGuard({ actor: anActor, membershipRole: "ADMIN" }),
      findMembership: async () => fakeMembership("MEMBER"),
    });
    await expect(
      entry({
        headers: noHeaders,
        companyId: "co_1",
        targetUserId: "u_2",
        parseBody: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });
});

describe("guard.effect.* は失敗を error channel に載せる (Effect program として合成可能)", () => {
  test("requireActor: 未認証は Effect の failure として Result object を返す", async () => {
    const { effect } = buildGuard({ actor: null });
    const failure = await Effect.runPromise(Effect.flip(effect.requireActor(noHeaders)));
    expect(failure).toEqual({ ok: false, error: "unauthorized", status: 401 });
  });

  test("requireMembership: 成功値は { actor, role } (ok flag は Promise 境界で付与される)", async () => {
    const g = buildGuard({ actor: anActor, membershipRole: "ADMIN" });
    const value = await Effect.runPromise(g.effect.requireMembership(noHeaders, "co_1"));
    expect(value).toEqual({ actor: anActor, role: "ADMIN" });
    expect(await g.requireMembership(noHeaders, "co_1")).toEqual({
      ok: true,
      actor: anActor,
      role: "ADMIN",
    });
  });

  test("getActor の throw は Effect 内で Sentry に記録されてから 401 になる (await 完了時点で記録済み)", async () => {
    const failure = new Error("redis down");
    const { requireActor } = createMembershipGuard({
      getActor: () => {
        throw failure;
      },
      findMembership: async () => undefined,
    });
    const result = await requireActor(noHeaders);
    expect(result).toEqual({ ok: false, error: "unauthorized", status: 401 });
    expect(capturedExceptions.map((c) => c.error)).toEqual([failure]);
  });
});

describe("短絡: 先行判定の失敗で後続の callback / repository を呼ばない", () => {
  test("requireRoleChange: 401 なら parseBody を呼ばない", async () => {
    let parseCalls = 0;
    const entry = makeRequireRoleChange({
      guard: buildGuard({ actor: null, membershipRole: "OWNER" }),
      findMembership: async () => fakeMembership("MEMBER"),
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      targetUserId: "u_2",
      parseBody: () => {
        parseCalls += 1;
        return { ok: true, data: { nextRole: "MEMBER" } };
      },
    });
    expect(r).toEqual({ ok: false, error: "unauthorized", status: 401 });
    expect(parseCalls).toBe(0);
  });

  test("requireInvite: ADMIN 未満の 403 なら parseBody を呼ばない (403 → 400 の順序)", async () => {
    let parseCalls = 0;
    const entry = makeRequireInvite({
      guard: buildGuard({ actor: anActor, membershipRole: "MEMBER" }),
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      parseBody: () => {
        parseCalls += 1;
        return { ok: false, details: { email: ["invalid"] } };
      },
    });
    expect(r).toEqual({ ok: false, error: "forbidden", status: 403 });
    expect(parseCalls).toBe(0);
  });
});

describe("失敗 object の形 (respond.ts の catalog / guardErrorResponse と byte-invariant)", () => {
  test("details 無しの invalid_argument は details key 自体を持たない", async () => {
    const r = await resolveParseBody(() => ({ ok: false }));
    expect(r).toEqual({ ok: false, error: "invalid_argument", status: 400 });
    expect("details" in r).toBe(false);
  });

  test("details 付きの invalid_argument は details を保持する", async () => {
    const r = await resolveParseBody(() => ({ ok: false, details: { fieldErrors: {} } }));
    expect(r).toEqual({
      ok: false,
      error: "invalid_argument",
      status: 400,
      details: { fieldErrors: {} },
    });
  });

  test("resolveParseBody の成功は { ok: true, data } (Promise 契約不変)", async () => {
    const r = await resolveParseBody(async () => ({ ok: true, data: { x: 1 } }));
    expect(r).toEqual({ ok: true, data: { x: 1 } });
  });
});
