import { describe, expect, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { DbError } from "../../errors";
import { UserRepo } from "../../account/ports";
import { MembershipRepo } from "../../membership/ports";
import { getRuntime } from "../../runtime";
import { makeAccountApiHandler } from "../account-http-api";
import { buildTestApp, SESSION_COOKIE_HEADER, stubAuthApi } from "./helpers";

const captured = recordSentryExceptions();
const boom = new Error("boom");
const dbCause = new Error("db timeout");
const JSON_POST = { method: "POST", headers: { "content-type": "application/json" } };

describe("PoC C: Hono に載せた HttpApi", () => {
  test("M3a 宣言した失敗は今と同じ status (401) で、body は _tag", async () => {
    const res = await buildTestApp(null).request("/api/account/companies/co_1/members");
    expect([res.status, await res.json()]).toEqual([401, { _tag: "Unauthorized" }]);
  });

  test("M3a 順序: cookie 無しで不正な body の role 変更 (今は 401 が 400 に優先する)", async () => {
    const res = await buildTestApp(null).request("/api/account/companies/co_1/members/u_1/role", {
      ...JSON_POST,
      body: JSON.stringify({ role: "BOSS" }),
    });
    expect(res.status).toBe(401);
  });

  test("M3b defect は 500 で、Sentry に原 Error が error level で届く", async () => {
    captured.length = 0;
    const app = buildTestApp(null, { getSession: () => Effect.die(boom) });
    const res = await app.request("/api/account/companies/co_1/members", {
      headers: SESSION_COOKIE_HEADER,
    });
    expect(res.status).toBe(500);
    expect(captured.map(([e, ctx]) => [e, ctx?.level])).toEqual([[boom, "error"]]);
  });

  test("M3c 境界の失敗 (DbError) は 500 で、Sentry に cause が warning level で届く (M5 任意の service を request ごとに差し替え)", async () => {
    captured.length = 0;
    const services = await getRuntime().context();
    const failingRepo = Context.make(
      MembershipRepo,
      MembershipRepo.of({
        ...Context.get(services, MembershipRepo),
        findMembership: () => Effect.fail(new DbError({ cause: dbCause })),
      }),
    );
    const actor = Effect.runSync(
      Effect.scoped(Layer.build(stubAuthApi({ id: "u_db", email: "db@example.com" }))),
    );
    const knownUser = Context.make(
      UserRepo,
      UserRepo.of({
        ...Context.get(services, UserRepo),
        findUserById: (id: string) =>
          Effect.succeed({ id, email: "db@example.com", lastUsedCompanyId: null } as never),
      }),
    );
    const context = Context.merge(
      Context.merge(Context.merge(services, actor), knownUser),
      failingRepo,
    );
    const { handler, dispose } = makeAccountApiHandler(Layer.succeedContext(context));
    const res = await handler(
      new Request("http://x/api/account/companies/co_1/members", {
        headers: SESSION_COOKIE_HEADER,
      }),
    );
    await dispose();
    expect(res.status).toBe(500);
    expect(captured.map(([e, ctx]) => [e, ctx?.level])).toEqual([[dbCause, "warning"]]);
  });
});
