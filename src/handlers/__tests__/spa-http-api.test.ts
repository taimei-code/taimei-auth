import { beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { Hono } from "hono";
import { partial } from "../../__tests__/live-runner";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { AuthApiError } from "../../errors";
import { membershipRepoFailing, signedIn } from "../../membership/__tests__/test-layers";
import { MembershipRepo } from "../../membership/ports";
import type { AppServices } from "../../runtime";
import { JSON_HEADERS } from "../client-facing-error";
import { mountSpaApi, runtimeServices } from "../spa-http-api";
import { buildAppWith, buildTestApp, SESSION_COOKIE_HEADER } from "./helpers";

const captured = recordSentryExceptions();
const boom = new Error("boom");
const dbCause = new Error("db timeout");
const authCause = new Error("auth down");

const signedInServices = <A extends AppServices>(...overrides: Layer.Layer<A>[]) =>
  Layer.mergeAll(signedIn("u_db", "db@example.com"), ...overrides);

const signedInApp = <A extends AppServices>(...overrides: Layer.Layer<A>[]) =>
  buildAppWith(signedInServices(...overrides));

const signedPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { ...JSON_HEADERS, ...SESSION_COOKIE_HEADER },
  body: JSON.stringify(body),
});

const INVALID_INVITATION = signedPost({ email: "not-an-email", role: "MEMBER" });

const authApiFailingApp = () =>
  buildTestApp(null, { getSession: () => Effect.fail(new AuthApiError({ cause: authCause })) });

beforeEach(() => {
  captured.length = 0;
});

describe("Hono に載せた SPA の HttpApi", () => {
  test("順序: cookie 無しで不正な body の role 変更は 400 より先に 401", async () => {
    const res = await buildTestApp(null).request("/api/account/companies/co_1/members/u_1/role", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ role: "BOSS" }),
    });
    expect(res.status).toBe(401);
  });

  test("defect は 500 で、Sentry に原 Error が error level で届く", async () => {
    const app = buildTestApp(null, { getSession: () => Effect.die(boom) });
    const res = await app.request("/api/account/companies/co_1/members", {
      headers: SESSION_COOKIE_HEADER,
    });
    expect(res.status).toBe(500);
    expect(captured.map(([e, ctx]) => [e, ctx?.level])).toEqual([[boom, "error"]]);
  });

  test("境界の失敗 (DbError) は 500 で、Sentry に cause が warning level で届く", async () => {
    const res = await signedInApp(membershipRepoFailing(dbCause)).request(
      "/api/account/companies/co_1/members",
      { headers: SESSION_COOKIE_HEADER },
    );
    expect(res.status).toBe(500);
    expect(captured.map(([e, ctx]) => [e, ctx?.level])).toEqual([[dbCause, "warning"]]);
  });

  test("Sentry の記録に、失敗した endpoint の method と path を付ける", async () => {
    await signedInApp(membershipRepoFailing(dbCause)).request(
      "/api/account/companies/co_1/members?x=1",
      { headers: SESSION_COOKIE_HEADER },
    );
    expect(captured.map(([, ctx]) => ctx?.extra)).toEqual([
      { method: "GET", path: "/api/account/companies/co_1/members" },
    ]);
  });

  test("宣言した失敗 (所属の無い人の一覧の 403) は Sentry に送らず、宣言の無い失敗は 1 件送る", async () => {
    const res = await signedInApp().request("/api/account/companies/co_none/members", {
      headers: SESSION_COOKIE_HEADER,
    });
    expect([res.status, captured.length]).toEqual([403, 0]);

    const undeclared = await signedInApp(membershipRepoFailing(dbCause)).request(
      "/api/account/companies/co_1/members",
      { headers: SESSION_COOKIE_HEADER },
    );
    expect([undeclared.status, captured.length]).toEqual([500, 1]);
  });

  test("順序: 認証済みで所属の無い人の不正な body の招待は、guard の 403 より先に decode の 400", async () => {
    const res = await signedInApp().request(
      "/api/account/companies/co_none/invitations",
      INVALID_INVITATION,
    );
    expect([res.status, await res.text()]).toEqual([400, ""]);
  });

  test("入力の decode 失敗 (400) は Sentry に送らない", async () => {
    const res = await signedInApp().request(
      "/api/account/companies/co_none/invitations",
      INVALID_INVITATION,
    );
    expect([res.status, captured.length]).toEqual([400, 0]);
  });

  test("cookie の無い request の 401 は Sentry に送らない", async () => {
    const res = await buildTestApp(null).request("/api/account/companies/co_1/members");
    expect([res.status, captured.length]).toEqual([401, 0]);
  });

  test("avatar の upload token: Vercel Blob の client が送る body (clientPayload・multipart 省略) を受け、client token を返す", async () => {
    const previous = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_secret";
    try {
      const res = await signedInApp().request(
        "/api/account/avatar/upload-token",
        signedPost({ type: "blob.generate-client-token", payload: { pathname: "avatar.png" } }),
      );
      expect([res.status, await res.json()]).toEqual([
        200,
        {
          type: "blob.generate-client-token",
          clientToken: expect.stringMatching(/^vercel_blob_client_teststore_/),
        },
      ]);
    } finally {
      if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = previous;
    }
  });

  test("Vercel からの blob.upload-completed は契約に無いので 400", async () => {
    const res = await signedInApp().request(
      "/api/account/avatar/upload-token",
      signedPost({
        type: "blob.upload-completed",
        payload: { blob: { url: "https://x/avatar.png" }, tokenPayload: null },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("session の解決で AuthApiError なら 401 で body は _tag", async () => {
    const res = await authApiFailingApp().request("/api/account/memberships", {
      headers: SESSION_COOKIE_HEADER,
    });
    expect([res.status, await res.json()]).toEqual([401, { _tag: "Unauthorized" }]);
  });

  test("session の解決で AuthApiError なら Sentry に cause を 1 回送る", async () => {
    await authApiFailingApp().request("/api/account/memberships", {
      headers: SESSION_COOKIE_HEADER,
    });
    expect(captured.map(([e]) => e)).toEqual([authCause]);
  });

  test("handler は mount の時点では組まず、最初の request で 1 回だけ組む", async () => {
    let builds = 0;
    const app = new Hono();
    mountSpaApi(
      app,
      Layer.mergeAll(
        runtimeServices(),
        signedInServices(),
        Layer.effectDiscard(Effect.sync(() => builds++)),
      ),
    );
    const beforeRequest = builds;
    await app.request("/api/account/memberships", { headers: SESSION_COOKIE_HEADER });
    const afterFirstRequest = builds;
    await app.request("/api/account/memberships", { headers: SESSION_COOKIE_HEADER });
    expect([beforeRequest, afterFirstRequest > 0, builds - afterFirstRequest]).toEqual([
      0,
      true,
      0,
    ]);
  });

  test("途中で接続を切った request は Sentry に送らない", async () => {
    const hanging = Layer.succeed(
      MembershipRepo,
      partial<MembershipRepo["Service"]>({ findMembershipsByUserId: () => Effect.never }),
    );
    const abort = new AbortController();
    const pending = signedInApp(hanging).request("/api/account/memberships", {
      headers: SESSION_COOKIE_HEADER,
      signal: abort.signal,
    });
    setTimeout(() => abort.abort(), 20);
    await pending;
    expect(captured.length).toBe(0);
  });
});
