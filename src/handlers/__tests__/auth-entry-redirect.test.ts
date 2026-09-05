import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Hono } from "hono";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { authEntryRedirect } from "../auth-entry-redirect";
import { requestApp, restoreActor, SESSION_COOKIE_HEADER, stubActor } from "./helpers";

// /auth/ エントリの session-aware redirect の分岐 (session 有無 × invitation_token ×
// membership 件数 × query 妥当性) を固定する。redirect loop (#74) と削除後 session (#112)
// の再発面。SPA 静的配信は fixture route で代替し、pass-through の成立を body で確認する
// (web/dist は CI に存在しないため)。

const P = "aer-test-";
const { run, cleanup } = dbTest(P);

const FIXTURE_BODY = "spa-shell-fixture";
const REDIRECT_URL = "http://auth.taimei-code.local:3100/account";
const VALID_QUERY = `service_name=accounts&redirect_url=${encodeURIComponent(REDIRECT_URL)}`;

const buildApp = () => {
  const app = new Hono();
  app.use("/auth/*", authEntryRedirect);
  app.get("/auth/*", (c) => c.html(FIXTURE_BODY));
  return app;
};

const request = (path: string, init?: RequestInit) => requestApp(buildApp(), path, init);

// pass-through の検証は「302 でない」だけでなく fixture body の到達まで確認する
const expectPassThrough = (res: Response) =>
  Effect.promise(async () => {
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toBe(FIXTURE_BODY);
  });

const seedAuthenticated = (suffix: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const actor = yield* db.seedUser(suffix);
    const companyId = yield* db.seedCompany(suffix);
    yield* db.seedMembership(actor.id, companyId, "OWNER");
    stubActor(actor);
  });

describe("authEntryRedirect", () => {
  beforeEach(cleanup);
  afterEach(restoreActor);
  afterAll(cleanup);

  describe("未認証 (session cookie 無し)", () => {
    test("有効 query の GET /auth/ は pass-through で SPA が返る", () =>
      run(
        Effect.gen(function* () {
          const res = yield* request(`/auth/?${VALID_QUERY}`);
          yield* expectPassThrough(res);
        }),
      ));

    test("invitation_token 付きでも未認証なら pass-through (招待メールを未ログインで開く最頻経路)", () =>
      run(
        Effect.gen(function* () {
          const res = yield* request(`/auth/?${VALID_QUERY}&invitation_token=inv-abc`);
          yield* expectPassThrough(res);
        }),
      ));
  });

  describe("session cookie はあるが session が無効", () => {
    test("getSession null (失効済み) は pass-through で 500 にしない", () =>
      run(
        Effect.gen(function* () {
          stubActor(null);
          const res = yield* request(`/auth/?${VALID_QUERY}`, { headers: SESSION_COOKIE_HEADER });
          yield* expectPassThrough(res);
        }),
      ));

    test("削除済み user の stale session (cookieCache 窓) は membership 0 件扱いで /auth/signup/company へ 302", () =>
      run(
        Effect.gen(function* () {
          // user 行を seed しない = cookieCache が返す「削除済み user の session」を再現。
          // この先の POST /api/account/companies が 401 で fail-closed する契約は
          // deleted-user-session.test.ts が固定している。
          stubActor({ id: `${P}u-ghost`, email: `${P}ghost@example.com` });
          const res = yield* request(`/auth/?${VALID_QUERY}`, { headers: SESSION_COOKIE_HEADER });

          expect(res.status).toBe(302);
          const location = new URL(res.headers.get("location") ?? "", "http://localhost");
          expect(location.pathname).toBe("/auth/signup/company");
        }),
      ));
  });

  describe("認証済 + membership の状態で分岐", () => {
    test("ACTIVE membership ありは redirect_url へ 302", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("m1");
          const companyId = yield* db.seedCompany("m1");
          yield* db.seedMembership(actor.id, companyId, "OWNER");
          stubActor(actor);

          const res = yield* request(`/auth/?${VALID_QUERY}`, { headers: SESSION_COOKIE_HEADER });

          expect(res.status).toBe(302);
          expect(res.headers.get("location")).toBe(REDIRECT_URL);
        }),
      ));

    test("membership 0 件は /auth/signup/company へ 302 し service_name / redirect_url を伝播、sign_up_url は伝播しない", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("m0");
          stubActor(actor);

          const signUpUrl = "http://auth.taimei-code.local:3100/welcome";
          const res = yield* request(
            `/auth/?${VALID_QUERY}&sign_up_url=${encodeURIComponent(signUpUrl)}`,
            { headers: SESSION_COOKIE_HEADER },
          );

          expect(res.status).toBe(302);
          const location = new URL(res.headers.get("location") ?? "", "http://localhost");
          expect(location.pathname).toBe("/auth/signup/company");
          expect(location.searchParams.get("service_name")).toBe("accounts");
          expect(location.searchParams.get("redirect_url")).toBe(REDIRECT_URL);
          expect(location.searchParams.has("sign_up_url")).toBe(false);
        }),
      ));

    test("DELETED company のみの membership (直接 seed) は /auth/signup/company へ 302", () =>
      run(
        Effect.gen(function* () {
          // 削除ライフサイクル適用後は通常経路で作れない状態だが、server 側 ACTIVE filter の
          // 防御を固定する (SPA page guard 側との 2 者契約は account-routes-migrated 側で pin)。
          const db = yield* TestDb;
          const actor = yield* db.seedUser("del");
          const companyId = yield* db.seedCompany("del");
          yield* db.seedMembership(actor.id, companyId, "OWNER");
          yield* db.markCompanyDeleted(companyId, { deletedAt: false });
          stubActor(actor);

          const res = yield* request(`/auth/?${VALID_QUERY}`, { headers: SESSION_COOKIE_HEADER });

          expect(res.status).toBe(302);
          const location = new URL(res.headers.get("location") ?? "", "http://localhost");
          expect(location.pathname).toBe("/auth/signup/company");
        }),
      ));

    test("ACTIVE + DELETED 混在は通常どおり redirect_url へ 302", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("mix");
          const activeCompanyId = yield* db.seedCompany("mix-a");
          const deletedCompanyId = yield* db.seedCompany("mix-d");
          yield* db.seedMembership(actor.id, activeCompanyId, "OWNER");
          yield* db.seedMembership(actor.id, deletedCompanyId, "OWNER");
          yield* db.markCompanyDeleted(deletedCompanyId, { deletedAt: false });
          stubActor(actor);

          const res = yield* request(`/auth/?${VALID_QUERY}`, { headers: SESSION_COOKIE_HEADER });

          expect(res.status).toBe(302);
          expect(res.headers.get("location")).toBe(REDIRECT_URL);
        }),
      ));
  });

  describe("認証済 + invitation_token", () => {
    test("membership 判定より優先で /auth/signup/accept-invitation へ 302 (redirect_url は伝播しない現状仕様)", () =>
      run(
        Effect.gen(function* () {
          yield* seedAuthenticated("inv");

          const res = yield* request(`/auth/?${VALID_QUERY}&invitation_token=inv-abc`, {
            headers: SESSION_COOKIE_HEADER,
          });

          expect(res.status).toBe(302);
          const location = new URL(res.headers.get("location") ?? "", "http://localhost");
          expect(location.pathname).toBe("/auth/signup/accept-invitation");
          expect(location.searchParams.get("invitation_token")).toBe("inv-abc");
          expect(location.searchParams.has("redirect_url")).toBe(false);
        }),
      ));
  });

  describe("query 不正 (open redirect 拒否)", () => {
    test("redirect_url が allowlist 外なら認証済でも pass-through し Location に現れない", () =>
      run(
        Effect.gen(function* () {
          yield* seedAuthenticated("evil");
          const res = yield* request(
            `/auth/?service_name=accounts&redirect_url=${encodeURIComponent("https://evil.com/")}`,
            { headers: SESSION_COOKIE_HEADER },
          );
          yield* expectPassThrough(res);
        }),
      ));

    test("service_name が未知値なら pass-through", () =>
      run(
        Effect.gen(function* () {
          yield* seedAuthenticated("unknown-svc");
          const res = yield* request(
            `/auth/?service_name=nazo&redirect_url=${encodeURIComponent(REDIRECT_URL)}`,
            { headers: SESSION_COOKIE_HEADER },
          );
          yield* expectPassThrough(res);
        }),
      ));

    test("redirect_url 2049 文字は invalid で pass-through、2048 文字は 302 (境界の両側)", () =>
      run(
        Effect.gen(function* () {
          yield* seedAuthenticated("len");
          const build = (total: number) => {
            const base = `${REDIRECT_URL}?p=`;
            return base + "a".repeat(total - base.length);
          };

          const over = yield* request(
            `/auth/?service_name=accounts&redirect_url=${encodeURIComponent(build(2049))}`,
            { headers: SESSION_COOKIE_HEADER },
          );
          yield* expectPassThrough(over);

          const exact = yield* request(
            `/auth/?service_name=accounts&redirect_url=${encodeURIComponent(build(2048))}`,
            { headers: SESSION_COOKIE_HEADER },
          );
          expect(exact.status).toBe(302);
          expect(exact.headers.get("location")).toBe(build(2048));
        }),
      ));
  });

  describe("対象パス集合と除外パス集合", () => {
    test("GET /auth/signup も認証済 + ACTIVE membership なら redirect_url へ 302 (対象パス 2 本目)", () =>
      run(
        Effect.gen(function* () {
          yield* seedAuthenticated("signup");
          const res = yield* request(`/auth/signup?${VALID_QUERY}`, {
            headers: SESSION_COOKIE_HEADER,
          });
          expect(res.status).toBe(302);
          expect(res.headers.get("location")).toBe(REDIRECT_URL);
        }),
      ));

    test.each([
      ["/auth/error", "signup_already_completed 等の表示に session 有でも到達が必要"],
      ["/auth/verify-magic-link", "magic link 着地が redirect されると sign-in 完了不能になる"],
    ])("認証済でも %s は pass-through (%s)", (path) =>
      run(
        Effect.gen(function* () {
          yield* seedAuthenticated(`excl${path.length}`);
          const res = yield* request(`${path}?${VALID_QUERY}`, { headers: SESSION_COOKIE_HEADER });
          yield* expectPassThrough(res);
        }),
      ));

    test("認証済 + membership 0 件でも GET /auth/signup/company は pass-through (誘導先が再 redirect されずループしない)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("loop");
          stubActor(actor);
          const res = yield* request(`/auth/signup/company?${VALID_QUERY}`, {
            headers: SESSION_COOKIE_HEADER,
          });
          yield* expectPassThrough(res);
        }),
      ));

    test("GET /auth (末尾スラッシュ無し) は認証済でも pass-through (AUTH_ENTRY_PATHS 非対象。退会後遷移先 /auth の素通り保証)", () =>
      run(
        Effect.gen(function* () {
          yield* seedAuthenticated("bare");
          const res = yield* request(`/auth?${VALID_QUERY}`, { headers: SESSION_COOKIE_HEADER });
          yield* expectPassThrough(res);
        }),
      ));
  });
});
