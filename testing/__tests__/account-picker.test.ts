import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { DEV_ACCOUNTS, seedDevAccounts } from "../../db/testing/dev-accounts";
import { buildApp } from "../../src/app";
import { dbTest } from "../../src/__tests__/live-runner";
import { browserCookieHeaders } from "../../src/__tests__/session-helpers";
import { TestDb } from "../../src/__tests__/test-db";
import { testingApiAndAccountPickerRoutes } from "../routes";

const P = "account-picker-test-";
const { run, cleanup } = dbTest(P);

const SPA_RESPONSE = "spa index.html";
const REDIRECT_URL = "http://localhost:3100/account";
const SIGN_IN_QUERY = `?${new URLSearchParams({ service_name: "accounts", redirect_url: REDIRECT_URL })}`;
const DISALLOWED_QUERY = `?${new URLSearchParams({ service_name: "accounts", redirect_url: "https://evil.example/" })}`;
const PICKER_PATH = `${TESTING_PATH}/account-picker`;

const app = buildApp({
  mountStatic: (honoApp) => {
    honoApp.route("/", testingApiAndAccountPickerRoutes());
    honoApp.use("/auth/*", async (c) => c.text(SPA_RESPONSE));
  },
});

const request = (path: string, init?: RequestInit) => Promise.resolve(app.request(path, init));

const openPicker = async (query = SIGN_IN_QUERY, headers?: HeadersInit) => {
  const response = await request(`/auth/${query}`, { headers });
  return { response, body: await response.text() };
};

const pick = (userId: string | undefined, query = SIGN_IN_QUERY) =>
  request(`${PICKER_PATH}${query}`, {
    method: "POST",
    body: new URLSearchParams(userId === undefined ? {} : { userId }),
  });

const unescapeAmpersands = (value: string) => value.replaceAll("&amp;", "&");

const formsOf = (body: string) =>
  [...body.matchAll(/<form method="(\w+)" action="([^"]*)">/g)].map(([, method, action]) => ({
    method,
    action: unescapeAmpersands(action ?? ""),
  }));

const [owner] = DEV_ACCOUNTS.users;
if (!owner) throw new Error("DEV_ACCOUNTS has no owner");

const signInAs = async (userId: string) => {
  const picked = await pick(userId);
  const magicLink = new URL(picked.headers.get("location") ?? "");
  return request(`${magicLink.pathname}${magicLink.search}`);
};

beforeAll(seedDevAccounts);
beforeEach(cleanup);
afterAll(cleanup);

describe("試験の環境の共通ログイン画面は、開発用アカウントと利用者の一覧を出す", () => {
  test("一覧は、開発用アカウントの名前・email と、所属する事業所の名前と role を出す", async () => {
    const { response, body } = await openPicker();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("text/html");
    for (const devUser of DEV_ACCOUNTS.users) {
      expect(body).toContain(devUser.name);
      expect(body).toContain(devUser.email);
    }
    for (const devCompany of DEV_ACCOUNTS.companies) expect(body).toContain(devCompany.name);
    for (const role of ["OWNER", "ADMIN", "MEMBER"]) expect(body).toContain(role);
  });

  test("一覧は開発用アカウント以外の利用者も出し、開発用アカウントを先頭に並べる", () =>
    run(
      Effect.gen(function* () {
        const other = yield* TestDb.use((db) => db.seedUser("other"));

        const { body } = yield* Effect.promise(() => openPicker());

        const devPositions = DEV_ACCOUNTS.users.map((devUser) => body.indexOf(devUser.email));
        expect(body.indexOf(other.email)).toBeGreaterThan(Math.max(...devPositions));
        expect(Math.min(...devPositions)).toBeGreaterThan(-1);
      }),
    ));

  test("一覧の各行は、開いた時の query を付けた試験 API へ利用者を POST する form である", async () => {
    const { body } = await openPicker();

    const forms = formsOf(body);
    expect(forms.length).toBeGreaterThanOrEqual(DEV_ACCOUNTS.users.length);
    for (const form of forms) {
      expect(form).toEqual({ method: "post", action: `${PICKER_PATH}${SIGN_IN_QUERY}` });
    }
  });

  test("一覧から、開いた時の query を付けた新規登録の画面へ移れる", async () => {
    const { body } = await openPicker();

    const hrefs = [...body.matchAll(/href="([^"]*)"/g)].map(([, href]) =>
      unescapeAmpersands(href ?? ""),
    );
    expect(hrefs).toContain(`/auth/signup${SIGN_IN_QUERY}`);
  });

  test("利用者の名前に HTML があっても、escape して出す", () =>
    run(
      Effect.gen(function* () {
        yield* TestDb.use((db) => db.seedUser("html", { name: "<script>alert(1)</script>" }));

        const { body } = yield* Effect.promise(() => openPicker());

        expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(body).not.toContain("<script>alert(1)");
      }),
    ));

  test("redirect_url が許可されない時は、一覧を出さずエラー画面へ移す", async () => {
    const { response } = await openPicker(DISALLOWED_QUERY);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/error?reason=invalid_redirect_url");
  });

  test("招待の受諾の途中 (invitation_token がある) は、一覧を出さず共通ログイン画面 (SPA) に渡す", async () => {
    const { body } = await openPicker(`${SIGN_IN_QUERY}&invitation_token=token`);

    expect(body).toBe(SPA_RESPONSE);
  });

  test("ログイン済みなら、一覧を出さず redirect_url へ移す", async () => {
    const signedIn = await signInAs(owner.id);

    const { response } = await openPicker(SIGN_IN_QUERY, browserCookieHeaders(signedIn));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(REDIRECT_URL);
  });
});

describe("一覧で選んだ利用者は、本物の Magic Link でログインする", () => {
  test("利用者を選ぶと、redirect_url に戻る Magic Link へ 303 で移す", async () => {
    const response = await pick(owner.id);

    expect(response.status).toBe(303);
    const location = response.headers.get("location") ?? "";
    expect(location).toStartWith(
      `${process.env.AUTH_SERVICE_URL}/api/auth/magic-link/verify?token=`,
    );
    expect(new URL(location).searchParams.get("callbackURL")).toBe(REDIRECT_URL);
  });

  test("その Magic Link を開くと、session cookie が付いて redirect_url へ移る", async () => {
    const opened = await signInAs(owner.id);

    expect(opened.headers.get("location")).toBe(REDIRECT_URL);
    expect(opened.headers.get("set-cookie")).toContain("session_token=");
  });

  test("いない利用者を選ぶと 404", async () => {
    expect((await pick("missing-user")).status).toBe(404);
  });

  test("redirect_url が許可されない query で選ぶと 400", async () => {
    expect((await pick(owner.id, DISALLOWED_QUERY)).status).toBe(400);
  });

  test("利用者を送らないと 400", async () => {
    expect((await pick(undefined)).status).toBe(400);
  });
});
