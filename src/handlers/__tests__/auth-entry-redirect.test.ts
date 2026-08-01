import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "@/db/client";
import { company } from "@/db/schema";
import { authEntryRedirect } from "../auth-entry-redirect";
import { SESSION_COOKIE_HEADER, createSeedHelpers, restoreActor, stubActor } from "./helpers";

// /auth/ エントリの session-aware redirect の分岐 (session 有無 × invitation_token ×
// membership 件数 × query 妥当性) を固定する。redirect loop (#74) と削除後 session (#112)
// の再発面。SPA 静的配信は fixture route で代替し、pass-through の成立を body で確認する
// (web/dist は CI に存在しないため)。

const P = "aer-test-";
const helpers = createSeedHelpers(P);

const FIXTURE_BODY = "spa-shell-fixture";
const REDIRECT_URL = "http://auth.taimei-code.local:3100/account";
const VALID_QUERY = `service_name=accounts&redirect_url=${encodeURIComponent(REDIRECT_URL)}`;

const buildApp = () => {
  const app = new Hono();
  app.use("/auth/*", authEntryRedirect);
  app.get("/auth/*", (c) => c.html(FIXTURE_BODY));
  return app;
};

// pass-through の検証は「302 でない」だけでなく fixture body の到達まで確認する
const expectPassThrough = async (res: Response) => {
  expect(res.status).toBe(200);
  expect(res.headers.get("location")).toBeNull();
  expect(await res.text()).toBe(FIXTURE_BODY);
};

describe("authEntryRedirect", () => {
  beforeEach(helpers.cleanup);
  afterEach(restoreActor);
  afterAll(helpers.cleanup);

  describe("未認証 (session cookie 無し)", () => {
    test("有効 query の GET /auth/ は pass-through で SPA が返る", async () => {
      const res = await buildApp().request(`/auth/?${VALID_QUERY}`);
      await expectPassThrough(res);
    });

    test("invitation_token 付きでも未認証なら pass-through (招待メールを未ログインで開く最頻経路)", async () => {
      const res = await buildApp().request(`/auth/?${VALID_QUERY}&invitation_token=inv-abc`);
      await expectPassThrough(res);
    });
  });

  describe("session cookie はあるが session が無効", () => {
    test("getSession null (失効済み) は pass-through で 500 にしない", async () => {
      stubActor(null);
      const res = await buildApp().request(`/auth/?${VALID_QUERY}`, {
        headers: SESSION_COOKIE_HEADER,
      });
      await expectPassThrough(res);
    });

    test("削除済み user の stale session (cookieCache 窓) は membership 0 件扱いで /auth/signup/company へ 302", async () => {
      // user 行を seed しない = cookieCache が返す「削除済み user の session」を再現。
      // この先の POST /api/account/companies が 401 で fail-closed する契約は
      // deleted-user-session.test.ts が固定している。
      stubActor({ id: `${P}u-ghost`, email: `${P}ghost@example.com` });
      const res = await buildApp().request(`/auth/?${VALID_QUERY}`, {
        headers: SESSION_COOKIE_HEADER,
      });

      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location") ?? "", "http://localhost");
      expect(location.pathname).toBe("/auth/signup/company");
    });
  });

  describe("認証済 + membership の状態で分岐", () => {
    test("ACTIVE membership ありは redirect_url へ 302", async () => {
      const actor = await helpers.seedUser("m1");
      const companyId = await helpers.seedCompany("m1");
      await helpers.seedMembership(actor.id, companyId, "OWNER");
      stubActor(actor);

      const res = await buildApp().request(`/auth/?${VALID_QUERY}`, {
        headers: SESSION_COOKIE_HEADER,
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(REDIRECT_URL);
    });

    test("membership 0 件は /auth/signup/company へ 302 し service_name / redirect_url を伝播、sign_up_url は伝播しない", async () => {
      const actor = await helpers.seedUser("m0");
      stubActor(actor);

      const signUpUrl = "http://auth.taimei-code.local:3100/welcome";
      const res = await buildApp().request(
        `/auth/?${VALID_QUERY}&sign_up_url=${encodeURIComponent(signUpUrl)}`,
        { headers: SESSION_COOKIE_HEADER },
      );

      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location") ?? "", "http://localhost");
      expect(location.pathname).toBe("/auth/signup/company");
      expect(location.searchParams.get("service_name")).toBe("accounts");
      expect(location.searchParams.get("redirect_url")).toBe(REDIRECT_URL);
      expect(location.searchParams.has("sign_up_url")).toBe(false);
    });

    test("DELETED company のみの membership (直接 seed) は /auth/signup/company へ 302", async () => {
      // 削除ライフサイクル適用後は通常経路で作れない状態だが、server 側 ACTIVE filter の
      // 防御を固定する (SPA page guard 側との 2 者契約は account-routes-migrated 側で pin)。
      const actor = await helpers.seedUser("del");
      const companyId = await helpers.seedCompany("del");
      await helpers.seedMembership(actor.id, companyId, "OWNER");
      await db
        .update(company)
        .set({ activationStatus: "DELETED" })
        .where(eq(company.id, companyId));
      stubActor(actor);

      const res = await buildApp().request(`/auth/?${VALID_QUERY}`, {
        headers: SESSION_COOKIE_HEADER,
      });

      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location") ?? "", "http://localhost");
      expect(location.pathname).toBe("/auth/signup/company");
    });

    test("ACTIVE + DELETED 混在は通常どおり redirect_url へ 302", async () => {
      const actor = await helpers.seedUser("mix");
      const activeCompanyId = await helpers.seedCompany("mix-a");
      const deletedCompanyId = await helpers.seedCompany("mix-d");
      await helpers.seedMembership(actor.id, activeCompanyId, "OWNER");
      await helpers.seedMembership(actor.id, deletedCompanyId, "OWNER");
      await db
        .update(company)
        .set({ activationStatus: "DELETED" })
        .where(eq(company.id, deletedCompanyId));
      stubActor(actor);

      const res = await buildApp().request(`/auth/?${VALID_QUERY}`, {
        headers: SESSION_COOKIE_HEADER,
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(REDIRECT_URL);
    });
  });

  describe("認証済 + invitation_token", () => {
    test("membership 判定より優先で /auth/signup/accept-invitation へ 302 (redirect_url は伝播しない現状仕様)", async () => {
      const actor = await helpers.seedUser("inv");
      const companyId = await helpers.seedCompany("inv");
      await helpers.seedMembership(actor.id, companyId, "OWNER");
      stubActor(actor);

      const res = await buildApp().request(`/auth/?${VALID_QUERY}&invitation_token=inv-abc`, {
        headers: SESSION_COOKIE_HEADER,
      });

      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location") ?? "", "http://localhost");
      expect(location.pathname).toBe("/auth/signup/accept-invitation");
      expect(location.searchParams.get("invitation_token")).toBe("inv-abc");
      expect(location.searchParams.has("redirect_url")).toBe(false);
    });
  });

  describe("query 不正 (open redirect 拒否)", () => {
    const seedAuthenticated = async (suffix: string) => {
      const actor = await helpers.seedUser(suffix);
      const companyId = await helpers.seedCompany(suffix);
      await helpers.seedMembership(actor.id, companyId, "OWNER");
      stubActor(actor);
    };

    test("redirect_url が allowlist 外なら認証済でも pass-through し Location に現れない", async () => {
      await seedAuthenticated("evil");
      const res = await buildApp().request(
        `/auth/?service_name=accounts&redirect_url=${encodeURIComponent("https://evil.com/")}`,
        { headers: SESSION_COOKIE_HEADER },
      );
      await expectPassThrough(res);
    });

    test("service_name が未知値なら pass-through", async () => {
      await seedAuthenticated("unknown-svc");
      const res = await buildApp().request(
        `/auth/?service_name=nazo&redirect_url=${encodeURIComponent(REDIRECT_URL)}`,
        { headers: SESSION_COOKIE_HEADER },
      );
      await expectPassThrough(res);
    });

    test("redirect_url 2049 文字は invalid で pass-through、2048 文字は 302 (境界の両側)", async () => {
      await seedAuthenticated("len");
      const build = (total: number) => {
        const base = `${REDIRECT_URL}?p=`;
        return base + "a".repeat(total - base.length);
      };

      const over = await buildApp().request(
        `/auth/?service_name=accounts&redirect_url=${encodeURIComponent(build(2049))}`,
        { headers: SESSION_COOKIE_HEADER },
      );
      await expectPassThrough(over);

      const exact = await buildApp().request(
        `/auth/?service_name=accounts&redirect_url=${encodeURIComponent(build(2048))}`,
        { headers: SESSION_COOKIE_HEADER },
      );
      expect(exact.status).toBe(302);
      expect(exact.headers.get("location")).toBe(build(2048));
    });
  });

  describe("対象パス集合と除外パス集合", () => {
    const seedAuthenticated = async (suffix: string) => {
      const actor = await helpers.seedUser(suffix);
      const companyId = await helpers.seedCompany(suffix);
      await helpers.seedMembership(actor.id, companyId, "OWNER");
      stubActor(actor);
    };

    test("GET /auth/signup も認証済 + ACTIVE membership なら redirect_url へ 302 (対象パス 2 本目)", async () => {
      await seedAuthenticated("signup");
      const res = await buildApp().request(`/auth/signup?${VALID_QUERY}`, {
        headers: SESSION_COOKIE_HEADER,
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(REDIRECT_URL);
    });

    test.each([
      ["/auth/error", "signup_already_completed 等の表示に session 有でも到達が必要"],
      ["/auth/verify-magic-link", "magic link 着地が redirect されると sign-in 完了不能になる"],
    ])("認証済でも %s は pass-through (%s)", async (path) => {
      await seedAuthenticated(`excl${path.length}`);
      const res = await buildApp().request(`${path}?${VALID_QUERY}`, {
        headers: SESSION_COOKIE_HEADER,
      });
      await expectPassThrough(res);
    });

    test("認証済 + membership 0 件でも GET /auth/signup/company は pass-through (誘導先が再 redirect されずループしない)", async () => {
      const actor = await helpers.seedUser("loop");
      stubActor(actor);
      const res = await buildApp().request(`/auth/signup/company?${VALID_QUERY}`, {
        headers: SESSION_COOKIE_HEADER,
      });
      await expectPassThrough(res);
    });

    test("GET /auth (末尾スラッシュ無し) は認証済でも pass-through (AUTH_ENTRY_PATHS 非対象。退会後遷移先 /auth の素通り保証)", async () => {
      await seedAuthenticated("bare");
      const res = await buildApp().request(`/auth?${VALID_QUERY}`, {
        headers: SESSION_COOKIE_HEADER,
      });
      await expectPassThrough(res);
    });
  });
});
