import { beforeEach, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer } from "effect";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { healthRepoLayer, ttlStorePingLayer } from "../../__tests__/test-layers";
import { DbError, TtlStoreError } from "../../errors";
import { SentryLive } from "../../sentry";
import type { TtlStore } from "../../ttl-store-service";
import type { HealthRepo } from "../ports";
import { probeHealth } from "../probe";

const captured = recordSentryExceptions();
beforeEach(() => {
  captured.length = 0;
});

const run = (db: Layer.Layer<HealthRepo>, ttl: Layer.Layer<TtlStore>) =>
  Effect.runPromise(
    Effect.exit(probeHealth()).pipe(Effect.provide(Layer.mergeAll(db, ttl, SentryLive))),
  );

const dbOk = healthRepoLayer(() => Effect.void);
const ttlOk = ttlStorePingLayer(() => Effect.void);

describe("probeHealth", () => {
  test("両 probe 成功 → ok / ok、Sentry 0 件", async () => {
    const exit = await run(dbOk, ttlOk);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Effect.runSync(exit)).toEqual({
      status: "ok",
      checks: { db: "ok", ttlStore: "ok" },
    });
    expect(captured.length).toBe(0);
  });

  test("DB 失敗 → degraded、db: error、Sentry に cause と check: db", async () => {
    const cause = new Error("pg down");
    const exit = await run(
      healthRepoLayer(() => new DbError({ cause })),
      ttlOk,
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Effect.runSync(exit)).toEqual({
      status: "degraded",
      checks: { db: "error", ttlStore: "ok" },
    });
    expect(captured.length).toBe(1);
    expect(captured[0]?.[0]).toBe(cause);
    expect(captured[0]?.[1]).toMatchObject({
      level: "warning",
      tags: { handler: "health", check: "db" },
    });
  });

  test("TTL store 失敗 → degraded、ttlStore: error、Sentry に cause と check: ttlStore", async () => {
    const cause = new Error("do unreachable");
    const exit = await run(
      dbOk,
      ttlStorePingLayer(() => new TtlStoreError({ cause })),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Effect.runSync(exit)).toEqual({
      status: "degraded",
      checks: { db: "ok", ttlStore: "error" },
    });
    expect(captured.length).toBe(1);
    expect(captured[0]?.[0]).toBe(cause);
    expect(captured[0]?.[1]).toMatchObject({
      level: "warning",
      tags: { handler: "health", check: "ttlStore" },
    });
  });

  test("両 probe 失敗 → error / error、Sentry 2 件 (db と ttlStore)", async () => {
    const exit = await run(
      healthRepoLayer(() => new DbError({ cause: new Error("pg") })),
      ttlStorePingLayer(() => new TtlStoreError({ cause: new Error("do") })),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Effect.runSync(exit)).toEqual({
      status: "degraded",
      checks: { db: "error", ttlStore: "error" },
    });
    expect(captured.map(([, ctx]) => ctx?.tags?.check).sort()).toEqual(["db", "ttlStore"]);
  });

  test("defect は畳まず Exit failure のまま、Sentry は probe 内で呼ばれない", async () => {
    const defect = new Error("bug");
    const exit = await run(
      healthRepoLayer(() => Effect.die(defect)),
      ttlOk,
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(defect);
    expect(captured.length).toBe(0);
  });
});
