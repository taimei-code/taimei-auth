import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import {
  addBrowserAccount,
  DEV_ACCOUNTS,
  prepareChoosableAccounts,
} from "../../db/testing/dev-accounts";
import { buildApp } from "../../src/app";
import { REPO_ROOT } from "../../src/__tests__/config-invariant-helpers";
import { dbTest } from "../../src/__tests__/live-runner";
import {
  browserCookieHeaders,
  issuedSessionCookieCount,
  sessionUserIdOf,
  setCookieValue,
} from "../../src/__tests__/session-helpers";
import { TestDb } from "../../src/__tests__/test-db";
import { callbackURLAfterVerify } from "../../src/email/dispatch-magic-link";
import { cleanupIssuedChallenges, enableMfaFor } from "../../src/mfa/__tests__/helpers";
import { BROWSER_KEY_COOKIE } from "../browser-key";
import { DEV_HOME_SIGN_IN_PATH, DEV_HOME_SIGN_OUT_PATH, devHomeRoutes } from "../dev-home";
import { inBrowser, requestInBrowser, seedBrowserAccount, withCookies } from "./in-browser";
import { magicLinksSentWhile } from "./magic-links-sent";
import { devHomePropsOf } from "./page-props-of";
import { AUTH_HOST_ORIGIN, HEADERS_WITHOUT_AUTH_HOST_ORIGIN } from "./origins";

const REDIRECT_URL = "http://localhost:3100/account?tab=a&x=1";
const REDIRECT_QUERY = `?${new URLSearchParams({ service_name: "accounts", redirect_url: REDIRECT_URL })}`;

const P = "dev-home-test-";
const { run } = dbTest(P);

const app = buildApp({ mountStatic: (honoApp) => honoApp.route("/", devHomeRoutes()) });

const TEST_BROWSER_KEY = crypto.randomUUID();

const request = requestInBrowser(app, TEST_BROWSER_KEY);

const seedChoosableUser = (suffix: string, options?: { name?: string; email?: string }) =>
  seedBrowserAccount(TEST_BROWSER_KEY, suffix, options);

const [owner, admin] = DEV_ACCOUNTS.users;
if (!owner || !admin) throw new Error("DEV_ACCOUNTS has fewer than 2 users");

const openHome = async (headers?: HeadersInit, query = "") =>
  devHomePropsOf(await (await request(`${DEV_HOME_PATH}${query}`, { headers })).text());

const emailsOf = (accounts: readonly { readonly email: string }[]) =>
  accounts.map(({ email }) => email);

const signedInEmailOf = ({ viewer }: Awaited<ReturnType<typeof openHome>>) =>
  viewer._tag === "SignedIn" ? viewer.account.email : undefined;

const noticeOf = ({ viewer }: Awaited<ReturnType<typeof openHome>>) => viewer.notice;

const withAuthHostOrigin = (headers?: HeadersInit) => {
  const headersWithOrigin = new Headers(headers);
  headersWithOrigin.set("origin", AUTH_HOST_ORIGIN);
  return headersWithOrigin;
};

const choose = (userId: string, headers?: HeadersInit, query = "") =>
  request(`${DEV_HOME_SIGN_IN_PATH}${query}`, {
    method: "POST",
    headers: withAuthHostOrigin(headers),
    body: new URLSearchParams({ userId }),
  });

const signOut = (headers: HeadersInit, query = "") =>
  request(`${DEV_HOME_SIGN_OUT_PATH}${query}`, {
    method: "POST",
    headers: withAuthHostOrigin(headers),
  });

const openMagicLink = (chosen: Response, headers?: HeadersInit) => {
  const magicLink = new URL(chosen.headers.get("location") ?? "");
  return request(`${magicLink.pathname}${magicLink.search}`, { headers });
};

const signInAs = async (userId: string, headers?: HeadersInit) =>
  browserCookieHeaders(await openMagicLink(await choose(userId, headers), headers));

const signedInUserIdOf = (headers: Headers) => run(sessionUserIdOf(headers));

const withoutCookieCache = (headers: Headers) =>
  new Headers({
    cookie: (headers.get("cookie") ?? "")
      .split("; ")
      .filter((pair) => pair.includes("session_token="))
      .join("; "),
  });

const cleanupAll = () =>
  run(
    Effect.gen(function* () {
      yield* cleanupIssuedChallenges();
      yield* (yield* TestDb).cleanup();
    }),
  );

beforeAll(prepareChoosableAccounts);
beforeEach(cleanupAll);
afterAll(cleanupAll);

describe("開発者ホームは、ログイン中の利用者と、選んでログインできる利用者の一覧を出す", () => {
  test("ログインしていなければ、そのことと、開発用アカウントを決めた順に渡す", async () => {
    const props = await openHome();

    expect(props.viewer._tag).toBe("SignedOut");
    expect(emailsOf(props.devAccounts)).toEqual(DEV_ACCOUNTS.users.map(({ email }) => email));
  });

  test("利用者の名前に HTML があっても、page の script 要素を閉じずに、そのままの名前を渡す", () =>
    run(
      Effect.gen(function* () {
        const name = "</script><script>x</script>";
        const user = yield* seedChoosableUser("escape", { name });

        const body = yield* Effect.promise(async () =>
          (await request(DEV_HOME_PATH, { headers: await signInAs(user.id) })).text(),
        );

        expect(body).not.toContain("<script>x");
        const { viewer } = devHomePropsOf(body);
        expect(viewer._tag === "SignedIn" ? viewer.account.name : undefined).toBe(name);
      }),
    ));

  test("redirect_url を受けなければ、戻り先をアカウント管理画面にする", async () => {
    expect((await openHome()).destination).toEqual({ _tag: "AccountPage" });
  });

  test("ログイン中の利用者は、ACTIVE の事業所と role を渡し、現在の事業所に印を付ける", async () => {
    const { viewer } = await openHome(await signInAs(owner.id));

    const companies = viewer._tag === "SignedIn" ? viewer.account.companies : [];
    expect(companies.length).toBeGreaterThan(0);
    expect(companies.filter(({ isCurrent }) => isCurrent)).toHaveLength(1);
  });
});

describe("開発者ホームは、開発用アカウントと、この browser でログインした利用者だけを候補に出す", () => {
  test("browser の鍵の cookie が無ければ、開発者ホームを開くと、全 path に届く HttpOnly の cookie を置き、開発用アカウントを出す", async () => {
    const response = await app.request(DEV_HOME_PATH);

    const cookie = setCookieOf(response, BROWSER_KEY_COOKIE) ?? "";
    expect(setCookieValue(cookie)).not.toBe("");
    expect(cookie).toContain("Path=/;");
    expect(cookie).toContain("HttpOnly");
    const props = devHomePropsOf(await response.text());
    expect(emailsOf(props.devAccounts)).toEqual(DEV_ACCOUNTS.users.map(({ email }) => email));
  });

  test("browser の鍵の cookie があれば、置き直さない", async () => {
    expect(setCookieOf(await request(DEV_HOME_PATH), BROWSER_KEY_COOKIE)).toBeUndefined();
  });

  test.each([
    "",
    "planted-key",
  ])("browser の鍵の cookie が server の発行した形でなければ (%p)、新しい鍵を置き直す", async (value) => {
    const response = await app.request(DEV_HOME_PATH, {
      headers: withCookies(undefined, { [BROWSER_KEY_COOKIE]: value }),
    });

    const issued = setCookieValue(setCookieOf(response, BROWSER_KEY_COOKIE) ?? "");
    expect(issued).not.toBe("");
    expect(issued).not.toBe(value);
  });

  test("ほかの browser でログインした利用者は、一覧に出さず、選んでも 404 で、Magic Link を送らない", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("other-browser"));
        yield* Effect.promise(() => addBrowserAccount(`${P}other-browser`, user.id));

        const props = yield* Effect.promise(() => openHome());
        const { response, magicLinksSent } = yield* magicLinksSentWhile(() => choose(user.id));

        expect(emailsOf([...props.devAccounts, ...props.browserAccounts])).not.toContain(
          user.email,
        );
        expect(response.status).toBe(404);
        expect(magicLinksSent).toBe(0);
      }),
    ));

  test("ログイン中に開発者ホームを開くと、その利用者をその browser の候補に足し、選べるようにする", () =>
    run(
      Effect.gen(function* () {
        const user = yield* seedChoosableUser("recorded");
        const signedIn = yield* Effect.promise(() => signInAs(user.id));
        const newBrowserKey = crypto.randomUUID();
        const newBrowser = (headers?: HeadersInit) => inBrowser(newBrowserKey, headers);

        const props = yield* Effect.promise(() => openHome(newBrowser(signedIn)));
        const chosen = yield* Effect.promise(() => choose(user.id, newBrowser()));

        expect(emailsOf(props.browserAccounts)).toContain(user.email);
        expect(chosen.status).toBe(303);
      }),
    ));
});

describe("開発者ホームで利用者を選ぶと、Magic Link でその利用者にログインし、開発者ホームに戻る", () => {
  test("選ぶと、開発者ホームに戻る Magic Link へ 303 で移す", async () => {
    const chosen = await choose(owner.id);

    expect(chosen.status).toBe(303);
    const location = chosen.headers.get("location") ?? "";
    expect(new URL(location).pathname).toBe("/api/auth/magic-link/verify");
    expect(callbackURLAfterVerify(location)).toBe(DEV_HOME_PATH);
  });

  test("Magic Link を開くと、選んだ利用者の session ができ、開発者ホームはその利用者を出す", async () => {
    const opened = await openMagicLink(await choose(owner.id));
    const headers = browserCookieHeaders(opened);

    expect(opened.status).toBe(302);
    expect(new URL(opened.headers.get("location") ?? "", "http://localhost").pathname).toBe(
      DEV_HOME_PATH,
    );
    expect(await signedInUserIdOf(headers)).toBe(owner.id);
    expect(signedInEmailOf(await openHome(headers))).toBe(owner.email);
  });

  test("ログイン中に別の利用者を選ぶと、その利用者の session に切り替わる", async () => {
    const asOwner = await signInAs(owner.id);

    const asAdmin = await signInAs(admin.id, asOwner);

    expect(await signedInUserIdOf(asAdmin)).toBe(admin.id);
    expect(signedInEmailOf(await openHome(asAdmin))).toBe(admin.email);
  });

  test.each([
    ["redirect_url を受けない", ""],
    ["redirect_url を受けた", REDIRECT_QUERY],
  ])("MFA を有効にした利用者を選ぶと、%s時も session を作らず MFA チャレンジへ移す", (_, query) =>
    run(
      Effect.gen(function* () {
        const user = yield* seedChoosableUser("mfa");
        yield* enableMfaFor(user);

        const opened = yield* Effect.promise(async () =>
          openMagicLink(await choose(user.id, undefined, query)),
        );

        expect(opened.status).toBe(302);
        expect(new URL(opened.headers.get("location") ?? "", "http://localhost").pathname).toBe(
          "/auth/mfa",
        );
        expect(yield* issuedSessionCookieCount(opened.headers)).toBe(0);
      }),
    ));

  test("いない利用者を選ぶと 404", async () => {
    expect((await choose("no-such-user")).status).toBe(404);
  });

  test("利用者を送らないと 400", async () => {
    const response = await request(DEV_HOME_SIGN_IN_PATH, {
      method: "POST",
      headers: withAuthHostOrigin(),
      body: new URLSearchParams(),
    });

    expect(response.status).toBe(400);
  });
});

describe("開発者ホームでログアウトすると、session を消して開発者ホームに戻る", () => {
  test("ログアウトすると、開発者ホームへ 303 で移し、server の session が無くなる (session の cookie cache を送らずに確かめる)", async () => {
    const signedIn = await signInAs(owner.id);

    const signedOut = await signOut(signedIn);

    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.get("location")).toBe(DEV_HOME_PATH);
    expect(await signedInUserIdOf(withoutCookieCache(signedIn))).toBeUndefined();
  });

  test("ログアウトの応答は、browser の session の cookie を消す Set-Cookie を返す", async () => {
    const signedIn = await signInAs(owner.id);

    const signedOut = await signOut(signedIn);
    const afterSignOut = browserCookieHeaders(signedOut);

    expect(
      signedOut.headers.getSetCookie().some((cookie) => cookie.includes("session_token=;")),
    ).toBe(true);
    expect((await openHome(afterSignOut)).viewer._tag).toBe("SignedOut");
  });
});

describe("開発者ホームは service_name と redirect_url を受けると、ログインの後に redirect_url へ移す", () => {
  test("redirect_url を戻り先にし、ログインとログアウトの送り先に同じ query を付ける", async () => {
    const response = await request(`${DEV_HOME_PATH}${REDIRECT_QUERY}`);
    const props = devHomePropsOf(await response.text());

    expect(response.status).toBe(200);
    expect(props.destination).toEqual({ _tag: "Application", redirectUrl: REDIRECT_URL });
    expect(props.signInAction).toBe(`${DEV_HOME_SIGN_IN_PATH}${REDIRECT_QUERY}`);
    expect(props.signOutAction).toBe(`${DEV_HOME_SIGN_OUT_PATH}${REDIRECT_QUERY}`);
  });

  test("選ぶと redirect_url を callbackURL にした Magic Link へ移し、開くと session ができて query ごと同じ redirect_url へ移る", async () => {
    const chosen = await choose(owner.id, undefined, REDIRECT_QUERY);

    expect(chosen.status).toBe(303);
    expect(callbackURLAfterVerify(chosen.headers.get("location") ?? "")).toBe(REDIRECT_URL);
    const opened = await openMagicLink(chosen);
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toBe(REDIRECT_URL);
    expect(await signedInUserIdOf(browserCookieHeaders(opened))).toBe(owner.id);
  });

  test("ログアウトすると、同じ query を付けて開発者ホームへ 303 で移し、server の session が無くなる", async () => {
    const signedIn = await signInAs(owner.id);

    const signedOut = await signOut(signedIn, REDIRECT_QUERY);

    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.get("location")).toBe(`${DEV_HOME_PATH}${REDIRECT_QUERY}`);
    expect(await signedInUserIdOf(withoutCookieCache(signedIn))).toBeUndefined();
  });
});

const notAllowedQueries = (
  [
    [
      "許可されない host の redirect_url",
      { service_name: "accounts", redirect_url: "https://evil.example/" },
    ],
    ["service_name だけ", { service_name: "accounts" }],
    ["redirect_url だけ", { redirect_url: REDIRECT_URL }],
  ] as const
).map(([label, query]) => [label, `?${new URLSearchParams(query)}`] as const);

describe("開発者ホームは、許可されない redirect_url を共通ログイン画面と同じく受け付けない", () => {
  test.each(notAllowedQueries)("%s で開くと、エラー画面へ 302 で移す", async (_, query) => {
    const response = await request(`${DEV_HOME_PATH}${query}`);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/error?reason=invalid_redirect_url");
  });

  test.each(notAllowedQueries)("%s で利用者を選ぶと 400", async (_, query) => {
    expect((await choose(owner.id, undefined, query)).status).toBe(400);
  });

  test.each(notAllowedQueries)("%s でログアウトすると 400 で、session は残る", async (_, query) => {
    const signedIn = await signInAs(owner.id);

    const signedOut = await signOut(signedIn, query);

    expect(signedOut.status).toBe(400);
    expect(await signedInUserIdOf(withoutCookieCache(signedIn))).toBe(owner.id);
  });
});

describe("開発者ホームで利用者を選ぶ POST は、auth ホスト以外の Origin から送られると 403 を返し、Magic Link を送らない", () => {
  test("auth ホストの Origin から選ぶと、Magic Link を 1 通送る", async () => {
    const { response, magicLinksSent } = await run(magicLinksSentWhile(() => choose(owner.id)));

    expect(response.status).toBe(303);
    expect(magicLinksSent).toBe(1);
  });

  test.each(
    HEADERS_WITHOUT_AUTH_HOST_ORIGIN,
  )("%s から選ぶと 403 で、Magic Link を送らない", async (_, headers) => {
    const { response, magicLinksSent } = await run(
      magicLinksSentWhile(() =>
        request(DEV_HOME_SIGN_IN_PATH, {
          method: "POST",
          headers,
          body: new URLSearchParams({ userId: owner.id }),
        }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('{"_tag":"Forbidden"}');
    expect(magicLinksSent).toBe(0);
  });
});

describe("開発者ホームのログアウトの POST は、auth ホスト以外の Origin から送られると 403 を返し、session を残す", () => {
  test.each([
    ...HEADERS_WITHOUT_AUTH_HOST_ORIGIN,
    ["別の origin の JSON", { origin: "https://evil.example", "content-type": "application/json" }],
  ])("%s から送ると 403 で、session は残る", async (_, headers) => {
    const signedIn = await signInAs(owner.id);

    const signedOut = await request(DEV_HOME_SIGN_OUT_PATH, {
      method: "POST",
      headers: { ...headers, cookie: signedIn.get("cookie") ?? "" },
    });

    expect(signedOut.status).toBe(403);
    expect(await signedInUserIdOf(withoutCookieCache(signedIn))).toBe(owner.id);
  });
});

describe("本番の bundle の検査は、開発者ホームの path を探す", () => {
  test("検査が探す開発者ホームの path は、開発者ホームの route と同じ", () => {
    const scriptPath = readFileSync(
      join(REPO_ROOT, "scripts/check-production-bundle.sh"),
      "utf8",
    ).match(/^dev_home_path="([^"]*)"$/m)?.[1];

    expect(scriptPath).toBe(DEV_HOME_PATH);
  });
});

const setCookieOf = (response: Response, name: string) =>
  response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));

const noticeCookieAttributes = ["Path=/dev-home", "HttpOnly", "SameSite=Lax", "Max-Age=300"];

describe("開発者ホームは、利用者を選んだ直後とログアウトした直後を、一度きりの cookie で次の画面に伝える", () => {
  test("redirect_url を受けずに選ぶと、選んだ利用者の id を開発者ホームの path に限った cookie に置く", async () => {
    const cookie = setCookieOf(await choose(owner.id), "dev_home_chosen_user");

    expect(setCookieValue(cookie ?? "")).toBe(owner.id);
    for (const attribute of noticeCookieAttributes) expect(cookie).toContain(attribute);
  });

  test("redirect_url を受けて選ぶと、開発者ホームに戻らないので cookie を置かない", async () => {
    expect(
      setCookieOf(await choose(owner.id, undefined, REDIRECT_QUERY), "dev_home_chosen_user"),
    ).toBeUndefined();
  });

  test("Magic Link を作れずに選ぶのが失敗すると、選んだ利用者の cookie を置かない", () =>
    run(
      Effect.gen(function* () {
        const user = yield* seedChoosableUser("no-link", { email: `${P}not-an-email` });

        const chosen = yield* Effect.promise(() => choose(user.id));

        expect(chosen.status).toBeGreaterThanOrEqual(400);
        expect(setCookieOf(chosen, "dev_home_chosen_user")).toBeUndefined();
      }),
    ));

  test("ログアウトの応答は、session の cookie を消す Set-Cookie と、ログアウトした印の Set-Cookie の両方を持つ (Hono は、返した応答の Set-Cookie を c.header で足した Set-Cookie で置き換えるので、どちらも c.header で足す)", async () => {
    const signedOut = await signOut(await signInAs(owner.id));

    const cookie = setCookieOf(signedOut, "dev_home_signed_out");
    expect(cookie).toBeDefined();
    for (const attribute of noticeCookieAttributes) expect(cookie).toContain(attribute);
    expect(
      signedOut.headers.getSetCookie().some((setCookie) => setCookie.includes("session_token=;")),
    ).toBe(true);
  });

  test("選んだ利用者の cookie が session の利用者と一致すると、ログインしたことを出し、通知の cookie を両方消す", async () => {
    const response = await request(DEV_HOME_PATH, {
      headers: withCookies(await signInAs(owner.id), { dev_home_chosen_user: owner.id }),
    });

    expect(noticeOf(devHomePropsOf(await response.text()))).toBe("JustSignedIn");
    for (const name of ["dev_home_chosen_user", "dev_home_signed_out"]) {
      const cookie = setCookieOf(response, name);
      expect(cookie).toBeDefined();
      expect(setCookieValue(cookie ?? "")).toBe("");
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("Path=/dev-home");
    }
  });

  test("選んだ利用者の cookie が session の利用者と違うと、ログインしたことを出さない", async () => {
    const props = await openHome(
      withCookies(await signInAs(admin.id), { dev_home_chosen_user: owner.id }),
    );

    expect(noticeOf(props)).toBe("None");
  });

  test("ログアウトした印の cookie があり、ログインしていなければ、ログアウトしたことを出す", async () => {
    const signedOut = await signOut(await signInAs(owner.id));

    expect(noticeOf(await openHome(browserCookieHeaders(signedOut)))).toBe("JustSignedOut");
  });

  test("ログアウトした印の cookie があっても、ログイン中ならログアウトしたことを出さない", async () => {
    const props = await openHome(
      withCookies(await signInAs(owner.id), { dev_home_signed_out: "1" }),
    );

    expect(noticeOf(props)).toBe("None");
  });

  test("通知の cookie が無ければ、ログイン中でも未ログインでも何も出さない", async () => {
    for (const props of [await openHome(), await openHome(await signInAs(owner.id))]) {
      expect(noticeOf(props)).toBe("None");
    }
  });
});
