import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { DEV_ACCOUNTS, prepareChoosableAccounts } from "../../db/testing/dev-accounts";
import { buildApp } from "../../src/app";
import { dbTest } from "../../src/__tests__/live-runner";
import { browserCookieHeaders, setCookieValue } from "../../src/__tests__/session-helpers";
import { BROWSER_KEY_COOKIE } from "../browser-key";
import { testingApiAndAccountPickerRoutes } from "../routes";
import { requestInBrowser, seedBrowserAccount } from "./in-browser";
import { magicLinksSentWhile } from "./magic-links-sent";
import { accountPickerPropsOf } from "./page-props-of";
import { AUTH_HOST_ORIGIN, HEADERS_WITHOUT_AUTH_HOST_ORIGIN } from "./origins";

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

const TEST_BROWSER_KEY = crypto.randomUUID();

const request = requestInBrowser(app, TEST_BROWSER_KEY);

const openPicker = async (query = SIGN_IN_QUERY, headers?: HeadersInit) => {
  const response = await request(`/auth/${query}`, { headers });
  return { response, body: await response.text() };
};

const pick = (
  userId: string | undefined,
  query = SIGN_IN_QUERY,
  headers: HeadersInit = { origin: AUTH_HOST_ORIGIN },
) =>
  request(`${PICKER_PATH}${query}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(userId === undefined ? {} : { userId }),
  });

const emailsOf = (body: string) => accountPickerPropsOf(body).accounts.map(({ email }) => email);

const [owner] = DEV_ACCOUNTS.users;
if (!owner) throw new Error("DEV_ACCOUNTS has no owner");

const signInAs = async (userId: string) => {
  const picked = await pick(userId);
  const magicLink = new URL(picked.headers.get("location") ?? "");
  return request(`${magicLink.pathname}${magicLink.search}`);
};

beforeAll(prepareChoosableAccounts);
beforeEach(cleanup);
afterAll(cleanup);

describe("試験の環境の共通ログイン画面は、開発用アカウントと、この browser でログインした利用者の一覧を出す", () => {
  test("一覧は、開発用アカウントの名前・email と、所属する事業所の名前と role を渡す", async () => {
    const { response, body } = await openPicker();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("text/html");
    const { accounts } = accountPickerPropsOf(body);
    for (const devUser of DEV_ACCOUNTS.users) {
      expect(accounts).toContainEqual(
        expect.objectContaining({ name: devUser.name, email: devUser.email }),
      );
    }
    const companies = accounts.flatMap((account) => account.companies);
    for (const devCompany of DEV_ACCOUNTS.companies) {
      expect(companies.map(({ name }) => name)).toContain(devCompany.name);
    }
    expect(new Set(companies.map(({ role }) => role))).toEqual(
      new Set(["OWNER", "ADMIN", "MEMBER"]),
    );
  });

  test("browser の鍵の cookie が無ければ、アカウント選択画面を開くと、全 path に届く HttpOnly の cookie を置く", async () => {
    const response = await app.request(`/auth/${SIGN_IN_QUERY}`);

    const cookie =
      response.headers.getSetCookie().find((c) => c.startsWith(`${BROWSER_KEY_COOKIE}=`)) ?? "";
    expect(setCookieValue(cookie)).not.toBe("");
    expect(cookie).toContain("Path=/;");
    expect(cookie).toContain("HttpOnly");
  });

  test("一覧は、この browser でログインした利用者を、開発用アカウントの後に並べる", () =>
    run(
      Effect.gen(function* () {
        const other = yield* seedBrowserAccount(TEST_BROWSER_KEY, "other");

        const { body } = yield* Effect.promise(() => openPicker());

        expect(emailsOf(body)).toEqual([
          ...DEV_ACCOUNTS.users.map(({ email }) => email),
          other.email,
        ]);
      }),
    ));

  test("選ぶ送り先と新規登録の画面に、開いた時の query を付ける", async () => {
    const { body } = await openPicker();

    const { chooseAction, signUpHref } = accountPickerPropsOf(body);
    expect(chooseAction).toBe(`${PICKER_PATH}${SIGN_IN_QUERY}`);
    expect(signUpHref).toBe(`/auth/signup${SIGN_IN_QUERY}`);
  });

  test("利用者の名前に HTML があっても、page の script 要素を閉じずに、そのままの名前を渡す", () =>
    run(
      Effect.gen(function* () {
        const name = "</script><script>alert(1)</script>";
        yield* seedBrowserAccount(TEST_BROWSER_KEY, "html", { name });

        const { body } = yield* Effect.promise(() => openPicker());

        expect(body).not.toContain("<script>alert(1)");
        expect(accountPickerPropsOf(body).accounts.map((account) => account.name)).toContain(name);
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

  test("ほかの browser でログインした利用者は、一覧に出さず、選んでも 404 で、Magic Link を送らない", () =>
    run(
      Effect.gen(function* () {
        const other = yield* seedBrowserAccount(crypto.randomUUID(), "elsewhere");

        const { body } = yield* Effect.promise(() => openPicker());
        const { response, magicLinksSent } = yield* magicLinksSentWhile(() => pick(other.id));

        expect(emailsOf(body)).not.toContain(other.email);
        expect(response.status).toBe(404);
        expect(magicLinksSent).toBe(0);
      }),
    ));

  test("redirect_url が許可されない query で選ぶと 400", async () => {
    expect((await pick(owner.id, DISALLOWED_QUERY)).status).toBe(400);
  });

  test("利用者を送らないと 400", async () => {
    expect((await pick(undefined)).status).toBe(400);
  });
});

describe("一覧で選ぶ POST は、auth ホスト以外の Origin から送られると 403 を返し、Magic Link を送らない", () => {
  test("auth ホストの Origin から選ぶと、Magic Link を 1 通送る", async () => {
    const { response, magicLinksSent } = await run(magicLinksSentWhile(() => pick(owner.id)));

    expect(response.status).toBe(303);
    expect(magicLinksSent).toBe(1);
  });

  test.each(
    HEADERS_WITHOUT_AUTH_HOST_ORIGIN,
  )("%s から選ぶと 403 で、Magic Link を送らない", async (_, headers) => {
    const { response, magicLinksSent } = await run(
      magicLinksSentWhile(() => pick(owner.id, SIGN_IN_QUERY, headers)),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('{"_tag":"Forbidden"}');
    expect(magicLinksSent).toBe(0);
  });
});
