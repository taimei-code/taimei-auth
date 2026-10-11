import { describe, expect, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { DbError } from "../../errors";
import { UserRepo } from "../../account/ports";
import { MembershipRepo } from "../../membership/ports";
import { type AppServices, getRuntime } from "../../runtime";
import { makeSpaApiHandler } from "../spa-http-api";
import { buildTestApp, SESSION_COOKIE_HEADER, stubAuthApi } from "./helpers";

const captured = recordSentryExceptions();
const boom = new Error("boom");
const dbCause = new Error("db timeout");
const JSON_POST = { method: "POST", headers: { "content-type": "application/json" } };

const signedInContext = async () => {
  const services = await getRuntime().context();
  const session = Effect.runSync(
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
  return Context.merge(Context.merge(services, session), knownUser);
};

const requestWith = async (context: Context.Context<AppServices>, request: Request) => {
  const { handler, dispose } = makeSpaApiHandler(Layer.succeedContext(context));
  const res = await handler(request);
  await dispose();
  return res;
};

describe("Hono に載せた SPA の HttpApi", () => {
  test("宣言した失敗は今と同じ status (401) で、body は _tag", async () => {
    const res = await buildTestApp(null).request("/api/account/companies/co_1/members");
    expect([res.status, await res.json()]).toEqual([401, { _tag: "Unauthorized" }]);
  });

  test("順序: cookie 無しで不正な body の role 変更は 400 より先に 401", async () => {
    const res = await buildTestApp(null).request("/api/account/companies/co_1/members/u_1/role", {
      ...JSON_POST,
      body: JSON.stringify({ role: "BOSS" }),
    });
    expect(res.status).toBe(401);
  });

  test("defect は 500 で、Sentry に原 Error が error level で届く", async () => {
    captured.length = 0;
    const app = buildTestApp(null, { getSession: () => Effect.die(boom) });
    const res = await app.request("/api/account/companies/co_1/members", {
      headers: SESSION_COOKIE_HEADER,
    });
    expect(res.status).toBe(500);
    expect(captured.map(([e, ctx]) => [e, ctx?.level])).toEqual([[boom, "error"]]);
  });

  test("境界の失敗 (DbError) は 500 で、Sentry に cause が warning level で届く", async () => {
    captured.length = 0;
    const services = await signedInContext();
    const failingRepo = Context.make(
      MembershipRepo,
      MembershipRepo.of({
        ...Context.get(services, MembershipRepo),
        findMembership: () => Effect.fail(new DbError({ cause: dbCause })),
      }),
    );
    const res = await requestWith(
      Context.merge(services, failingRepo),
      new Request("http://x/api/account/companies/co_1/members", {
        headers: SESSION_COOKIE_HEADER,
      }),
    );
    expect(res.status).toBe(500);
    expect(captured.map(([e, ctx]) => [e, ctx?.level])).toEqual([[dbCause, "warning"]]);
  });

  test("順序: 認証済みで所属の無い人の不正な body の招待は、guard の 403 より先に decode の 400", async () => {
    const res = await requestWith(
      await signedInContext(),
      new Request("http://x/api/account/companies/co_none/invitations", {
        ...JSON_POST,
        headers: { ...JSON_POST.headers, ...SESSION_COOKIE_HEADER },
        body: JSON.stringify({ email: "not-an-email", role: "MEMBER" }),
      }),
    );
    expect([res.status, await res.text()]).toEqual([400, ""]);
  });

  test("avatar の upload token: Vercel Blob の protocol の body を受け、client token を返す", async () => {
    const previous = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_secret";
    try {
      const res = await requestWith(
        await signedInContext(),
        new Request("http://x/api/account/avatar/upload-token", {
          ...JSON_POST,
          headers: { ...JSON_POST.headers, ...SESSION_COOKIE_HEADER },
          body: JSON.stringify({
            type: "blob.generate-client-token",
            payload: { pathname: "avatar.png", clientPayload: null, multipart: false },
          }),
        }),
      );
      const body = (await res.json()) as { type: string; clientToken: string };
      expect([res.status, body.type]).toEqual([200, "blob.generate-client-token"]);
      expect(body.clientToken.startsWith("vercel_blob_client_teststore_")).toBe(true);
    } finally {
      process.env.BLOB_READ_WRITE_TOKEN = previous;
    }
  });
});
