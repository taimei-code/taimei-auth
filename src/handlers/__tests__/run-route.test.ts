import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Hono } from "hono";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { runBackground, withWaitUntil } from "../../background";
import { DbError } from "../../errors";
import { Forbidden } from "../../membership/guard/errors";
import { runMiddleware, runRoute } from "../run-route";

// design §3.2 (2 次・3 次改訂): runRoute は唯一の写像点。failure → wire、boundary error / defect / interrupt →
// Sentry + 500。Hono が Error を飲み込むため adapter が自分で Sentry に送る (AC-010〜015, 060, 061)。
const captured = recordSentryExceptions();

const boom = new Error("boom");
const dbCause = new Error("db timeout");
const okResponse = new Response("ok");

function buildApp() {
  const app = new Hono();
  app.get("/ok", (c) => runRoute(c, Effect.succeed(okResponse)));
  app.get("/forbidden", (c) => runRoute(c, Effect.fail(new Forbidden())));
  app.get("/db", (c) => runRoute(c, Effect.fail(new DbError({ cause: dbCause }))));
  app.get("/die", (c) => runRoute(c, Effect.die(boom)));
  app.get("/throw", (c) =>
    runRoute(
      c,
      Effect.sync(() => {
        throw boom;
      }),
    ),
  );
  app.get("/interrupt", (c) => runRoute(c, Effect.interrupt));
  return app;
}

describe("runRoute", () => {
  test("成功は program が返した Response そのもの", async () => {
    const res = await buildApp().request("/ok");
    expect(res).toBe(okResponse);
  });

  test("failure は wire (status / content-type / body)", async () => {
    const res = await buildApp().request("/forbidden");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('{"error":"forbidden"}');
  });

  test("boundary error は 500 と Sentry(cause の identity)", async () => {
    captured.length = 0;
    const res = await buildApp().request("/db");
    expect([res.status, res.headers.get("content-type"), await res.text()]).toEqual([
      500,
      "text/plain; charset=UTF-8",
      "Internal Server Error",
    ]);
    expect(captured.length).toBe(1);
    expect(captured[0]?.[0]).toBe(dbCause);
    expect(captured[0]?.[1]?.level).toBe("warning");
  });

  test("defect (Effect.die) は 500 と Sentry(原 Error、level error)、Promise は reject しない", async () => {
    captured.length = 0;
    const res = await buildApp().request("/die");
    expect(res.status).toBe(500);
    expect(captured[0]?.[0]).toBe(boom);
    expect(captured[0]?.[1]?.level).toBe("error");
  });

  test("program 内の同期 throw も defect として 500 と Sentry(原 Error)", async () => {
    captured.length = 0;
    const res = await buildApp().request("/throw");
    expect(res.status).toBe(500);
    expect(captured[0]?.[0]).toBe(boom);
  });

  test("interrupt は 500 と Cause.pretty を message に持つ Error", async () => {
    captured.length = 0;
    const res = await buildApp().request("/interrupt");
    expect([res.status, await res.text()]).toEqual([500, "Internal Server Error"]);
    expect(captured.length).toBe(1);
    expect(captured[0]?.[0]).toBeInstanceOf(Error);
    expect((captured[0]?.[0] as Error).message).toMatch(/[Ii]nterrupt/);
  });

  test("Fail(wire) と Die が同居する Cause は defect を Sentry に送りつつ wire の 4xx を返す", async () => {
    captured.length = 0;
    const app = new Hono();
    app.get("/both", (c) =>
      runRoute(
        c,
        Effect.fail(new Forbidden()).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              throw boom;
            }),
          ),
        ),
      ),
    );
    const res = await app.request("/both");
    expect([res.status, await res.text()]).toEqual([403, '{"error":"forbidden"}']);
    expect(captured.map(([e]) => e)).toEqual([boom]);
  });

  test("catalog 外の形の failure は fail-open (200) にせず 500 + Sentry", async () => {
    captured.length = 0;
    const rogue = { _tag: "Rogue" } as unknown as Forbidden;
    const app = new Hono();
    app.get("/rogue", (c) => runRoute(c, Effect.fail(rogue)));
    const bad = await app.request("/rogue");
    expect(bad.status).toBe(500);
    expect(captured[0]?.[0]).toBe(rogue);
  });

  test("program が c.header() で staged した header は error 応答にも載る", async () => {
    const app = new Hono();
    app.get("/staged", (c) =>
      runRoute(
        c,
        Effect.sync(() => {
          c.header("Cache-Control", "private, no-store");
        }).pipe(Effect.flatMap(() => Effect.fail(new Forbidden()))),
      ),
    );
    const res = await app.request("/staged");
    expect([res.status, res.headers.get("cache-control"), res.headers.get("content-type")]).toEqual(
      [403, "private, no-store", "application/json"],
    );
  });

  test("Sentry の context に method と path が載る", async () => {
    captured.length = 0;
    await buildApp().request("/die");
    expect(captured[0]?.[1]?.extra).toMatchObject({ method: "GET", path: "/die" });
  });

  test("program 内の runBackground は ALS carrier に登録される (Effect scheduler 越し)", async () => {
    const collected: Promise<unknown>[] = [];
    const p = Promise.resolve("bg");
    const app = new Hono();
    // Effect.sleep で fiber を一度 suspend させ、scheduler の resume を挟んだ後でも ALS store が残ることを見る。
    app.get("/bg", (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          yield* Effect.sleep("1 millis");
          runBackground(p);
          return c.json({ ok: true });
        }),
      ),
    );
    const res = await withWaitUntil(
      (promise) => {
        collected.push(promise);
      },
      () => app.request("/bg"),
    );
    expect(res.status).toBe(200);
    expect(collected).toEqual([p]);
  });
});

describe("runMiddleware", () => {
  test("program が undefined を返すと next() に進む", async () => {
    const app = new Hono();
    app.use("*", (c, next) => runMiddleware(c, next, Effect.succeed(undefined)));
    app.get("/x", (c) => c.text("handled"));
    expect(await (await app.request("/x")).text()).toBe("handled");
  });

  test("program が Response を返すと短絡する", async () => {
    const app = new Hono();
    app.use("*", (c, next) =>
      runMiddleware(c, next, Effect.succeed(new Response("blocked", { status: 401 }))),
    );
    app.get("/x", (c) => c.text("handled"));
    const res = await app.request("/x");
    expect([res.status, await res.text()]).toEqual([401, "blocked"]);
  });

  test("failure は runRoute と同じ wire", async () => {
    const app = new Hono();
    app.use("*", (c, next) => runMiddleware(c, next, Effect.fail(new Forbidden())));
    app.get("/x", (c) => c.text("handled"));
    const res = await app.request("/x");
    expect([res.status, await res.text()]).toEqual([403, '{"error":"forbidden"}']);
  });
});
