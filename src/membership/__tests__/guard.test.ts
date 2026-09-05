import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { DbError, tryAuthApi } from "../../errors";
import { requireActor, requireMembership, requireMembershipOf } from "../guard";
import {
  authFailing,
  authLayer,
  membershipRepoFailing,
  membershipRepoLayer,
  run,
  runOk,
  sessionOf,
  signedIn,
  signedOut,
  userRepoFailing,
  userRepoLayer,
} from "./test-layers";

// 判定・fail-closed・Sentry の観測を旧 guard.test.ts (Promise / deps factory、19 test) から引き継ぐ (AC-036)。
const captured = recordSentryExceptions();
const headers = new Headers();

describe("requireActor", () => {
  test("session 無し → Unauthorized (401)", async () => {
    const e = await run(requireActor(headers).pipe(Effect.provide(signedOut())));
    expect([e._tag, e.status]).toEqual(["Unauthorized", 401]);
  });

  test("session + user 行 → Actor (id / email / lastUsedCompanyId)", async () => {
    const actor = await runOk(requireActor(headers).pipe(Effect.provide(signedIn("u1", "a@x.jp"))));
    expect(actor).toEqual({ id: "u1", email: "a@x.jp", lastUsedCompanyId: null });
  });

  test("session はあるが user 行が無い (cookieCache 残留) → Unauthorized (fail-closed)", async () => {
    const layer = Layer.mergeAll(
      authLayer(() => sessionOf("gone")),
      userRepoLayer([]),
    );
    const e = await run(requireActor(headers).pipe(Effect.provide(layer)));
    expect(e._tag).toBe("Unauthorized");
  });

  test("Auth が AuthApiError → Unauthorized (fail-closed: 誤って通さず拒否)", async () => {
    const layer = Layer.mergeAll(authFailing(new Error("redis down")), userRepoLayer([]));
    const e = await run(requireActor(headers).pipe(Effect.provide(layer)));
    expect(e._tag).toBe("Unauthorized");
  });

  test("Auth が AuthApiError → Sentry に cause を component=membership-guard で記録する", async () => {
    captured.length = 0;
    const cause = new Error("redis down");
    const layer = Layer.mergeAll(authFailing(cause), userRepoLayer([]));
    await run(requireActor(headers).pipe(Effect.provide(layer)));
    expect(captured.length).toBe(1);
    expect(captured[0]?.[0]).toBe(cause);
    expect(captured[0]?.[1]?.tags).toEqual({ component: "membership-guard" });
  });

  test("session 無し (未認証) → Sentry には記録しない", async () => {
    captured.length = 0;
    await run(requireActor(headers).pipe(Effect.provide(signedOut())));
    expect(captured.length).toBe(0);
  });

  test("AuthApi の thunk が同期 throw → Unauthorized (fail-closed、tryAuthApi が E に載せる)", async () => {
    captured.length = 0;
    const boom = new Error("sync throw");
    const layer = Layer.mergeAll(
      authLayer(() =>
        tryAuthApi(() => {
          throw boom;
        }),
      ),
      userRepoLayer([]),
    );
    const e = await run(requireActor(headers).pipe(Effect.provide(layer)));
    expect(e._tag).toBe("Unauthorized");
    expect(captured[0]?.[0]).toBe(boom);
  });

  test("UserRepo が DbError → Unauthorized (fail-closed、Sentry 記録あり)", async () => {
    captured.length = 0;
    const cause = new Error("db down");
    const layer = Layer.mergeAll(
      authLayer(() => sessionOf("u1")),
      userRepoFailing(cause),
    );
    const e = await run(requireActor(headers).pipe(Effect.provide(layer)));
    expect(e._tag).toBe("Unauthorized");
    expect(captured[0]?.[0]).toBe(cause);
  });
});

const actor = { id: "u1", email: "u1@example.com", lastUsedCompanyId: null };

describe("requireMembershipOf", () => {
  const rows = (role: string) => membershipRepoLayer([{ userId: "u1", companyId: "c1", role }]);

  test("非所属 → Forbidden (403)", async () => {
    const e = await run(
      requireMembershipOf(actor, "c1").pipe(Effect.provide(membershipRepoLayer([]))),
    );
    expect([e._tag, e.status]).toEqual(["Forbidden", 403]);
  });

  test("所属あり minRole 省略 → role (MEMBER でも通る)", async () => {
    expect(await runOk(requireMembershipOf(actor, "c1").pipe(Effect.provide(rows("MEMBER"))))).toBe(
      "MEMBER",
    );
  });

  test("MEMBER が ADMIN 要求 → Forbidden", async () => {
    const e = await run(
      requireMembershipOf(actor, "c1", "ADMIN").pipe(Effect.provide(rows("MEMBER"))),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("ADMIN が ADMIN 要求 → ok", async () => {
    expect(
      await runOk(requireMembershipOf(actor, "c1", "ADMIN").pipe(Effect.provide(rows("ADMIN")))),
    ).toBe("ADMIN");
  });

  test("ADMIN が OWNER 要求 → Forbidden", async () => {
    const e = await run(
      requireMembershipOf(actor, "c1", "OWNER").pipe(Effect.provide(rows("ADMIN"))),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("OWNER は全 minRole を満たす", async () => {
    for (const min of ["MEMBER", "ADMIN", "OWNER"] as const) {
      expect(
        await runOk(requireMembershipOf(actor, "c1", min).pipe(Effect.provide(rows("OWNER")))),
      ).toBe("OWNER");
    }
  });

  test("minRole 指定 + 想定外 role 文字列 → Forbidden (fail-closed)", async () => {
    const e = await run(
      requireMembershipOf(actor, "c1", "MEMBER").pipe(Effect.provide(rows("SUPERUSER"))),
    );
    expect(e._tag).toBe("Forbidden");
  });

  test("minRole 省略なら想定外 role でも通る (旧挙動等価)", async () => {
    const role: string = await runOk(
      requireMembershipOf(actor, "c1").pipe(Effect.provide(rows("SUPERUSER"))),
    );
    expect(role).toBe("SUPERUSER");
  });
});

describe("requireMembership (requireActor + requireMembershipOf の合成)", () => {
  test("未認証 → Unauthorized (membership を問わない)", async () => {
    const layer = Layer.mergeAll(
      signedOut(),
      membershipRepoLayer([{ userId: "u1", companyId: "c1", role: "OWNER" }]),
    );
    const e = await run(requireMembership(headers, "c1").pipe(Effect.provide(layer)));
    expect(e._tag).toBe("Unauthorized");
  });

  test("認証済・非所属 → Forbidden", async () => {
    const layer = Layer.mergeAll(signedIn(), membershipRepoLayer([]));
    const e = await run(requireMembership(headers, "c1").pipe(Effect.provide(layer)));
    expect(e._tag).toBe("Forbidden");
  });

  test("認証済・minRole 不足 → Forbidden", async () => {
    const layer = Layer.mergeAll(
      signedIn(),
      membershipRepoLayer([{ userId: "u1", companyId: "c1", role: "MEMBER" }]),
    );
    const e = await run(requireMembership(headers, "c1", "ADMIN").pipe(Effect.provide(layer)));
    expect(e._tag).toBe("Forbidden");
  });

  test("認証済・minRole 充足 → { actor, role }", async () => {
    const layer = Layer.mergeAll(
      signedIn(),
      membershipRepoLayer([{ userId: "u1", companyId: "c1", role: "ADMIN" }]),
    );
    const r = await runOk(requireMembership(headers, "c1", "ADMIN").pipe(Effect.provide(layer)));
    expect(r).toEqual({ actor, role: "ADMIN" });
  });

  test("QA-R-05 MembershipRepo の DbError は捕捉せず伝播する (fail-closed の対象は session 解決のみ)", async () => {
    const cause = new Error("db timeout");
    const layer = Layer.mergeAll(signedIn(), membershipRepoFailing(cause));
    const e = await run(requireMembership(headers, "c1").pipe(Effect.provide(layer)));
    expect(e).toBeInstanceOf(DbError);
    expect((e as DbError).cause).toBe(cause);
  });
});
