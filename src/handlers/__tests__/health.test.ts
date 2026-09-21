import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { healthRepoLayer, ttlStorePingLayer } from "../../__tests__/test-layers";
import { buildApp } from "../../app";
import { DbError } from "../../errors";
import type { HealthRepo } from "../../health/ports";
import { SentryLive } from "../../sentry";
import { healthProgram } from "../health";
import { runProgramInRoute } from "./run-program-in-route";

recordSentryExceptions();

const call = (pingDatabase: HealthRepo["Service"]["pingDatabase"]) =>
  runProgramInRoute(
    "/health",
    "http://localhost/health",
    healthProgram,
    Layer.mergeAll(
      healthRepoLayer(pingDatabase),
      ttlStorePingLayer(() => Effect.void),
      SentryLive,
    ),
  );

describe("GET /health", () => {
  test("ok → 200、body は status / checks / version の順 (smoke 互換)", async () => {
    const res = await call(() => Effect.void);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(
      /^\{"status":"ok","checks":\{"db":"ok","ttlStore":"ok"\},"version":/,
    );
  });

  test("degraded → 503、checks は probe の値そのまま", async () => {
    const res = await call(() => new DbError({ cause: new Error("pg down") }));
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(
      /^\{"status":"degraded","checks":\{"db":"error","ttlStore":"ok"\},"version":/,
    );
  });

  test("buildApp の catch-all (SPA fallback) より前に登録され JSON を返す", async () => {
    const app = buildApp({ mountStatic: (a) => a.get("*", (c) => c.text("spa")) });
    const res = await app.request("http://localhost/health");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.text()).not.toBe("spa");
  });
});
