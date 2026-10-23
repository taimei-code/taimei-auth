import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { DEV_ACCOUNTS, seedDevAccounts } from "../../db/testing/dev-accounts";
import { buildApp } from "../../src/app";
import { REPO_ROOT } from "../../src/__tests__/config-invariant-helpers";
import { dbTest } from "../../src/__tests__/live-runner";
import {
  browserCookieHeaders,
  issuedSessionCookieCount,
  sessionUserIdOf,
} from "../../src/__tests__/session-helpers";
import { TestDb } from "../../src/__tests__/test-db";
import { cleanupIssuedChallenges, enableMfaFor } from "../../src/mfa/__tests__/helpers";
import { DEV_HOME_SIGN_IN_PATH, DEV_HOME_SIGN_OUT_PATH, devHomeRoutes } from "../dev-home";
import { magicLinksSentWhile } from "./magic-links-sent";
import { AUTH_HOST_ORIGIN, HEADERS_WITHOUT_AUTH_HOST_ORIGIN } from "./origins";

const REDIRECT_URL = "http://localhost:3100/account?tab=a&x=1";
const REDIRECT_QUERY = `?${new URLSearchParams({ service_name: "accounts", redirect_url: REDIRECT_URL })}`;
const escapedForHtmlAttribute = (value: string) => value.replaceAll("&", "&amp;");

const P = "dev-home-test-";
const { run } = dbTest(P);

const app = buildApp({ mountStatic: (honoApp) => honoApp.route("/", devHomeRoutes()) });

const request = (path: string, init?: RequestInit) => Promise.resolve(app.request(path, init));

const [owner, admin] = DEV_ACCOUNTS.users;
if (!owner || !admin) throw new Error("DEV_ACCOUNTS has fewer than 2 users");

const openHome = async (headers?: HeadersInit, query = "") =>
  (await request(`${DEV_HOME_PATH}${query}`, { headers })).text();

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

const signedInSectionOf = (body: string) =>
  body.slice(body.indexOf('id="signed-in"'), body.indexOf('id="accounts"'));

const cleanupAll = () =>
  run(
    Effect.gen(function* () {
      yield* cleanupIssuedChallenges();
      yield* (yield* TestDb).cleanup();
    }),
  );

beforeAll(seedDevAccounts);
beforeEach(cleanupAll);
afterAll(cleanupAll);

describe("開発者ホームは、ログイン中の利用者と、選んでログインできる利用者の一覧を出す", () => {
  test("ログインしていなければ、そのことと、開発用アカウントの一覧を出す", async () => {
    const body = await openHome();

    expect(signedInSectionOf(body)).toContain("ログインしていません");
    for (const devUser of DEV_ACCOUNTS.users) expect(body).toContain(devUser.email);
  });

  test("利用者の名前に HTML があっても、escape して出す", () =>
    run(
      Effect.gen(function* () {
        yield* TestDb.use((db) => db.seedUser("escape", { name: "<script>x</script>" }));

        const body = yield* Effect.promise(() => openHome());

        expect(body).not.toContain("<script>x</script>");
        expect(body).toContain("&lt;script&gt;x&lt;/script&gt;");
      }),
    ));

  test("redirect_url を受けなければ、アプリケーションに戻る link を出さない", async () => {
    expect(await openHome()).not.toContain("アプリケーションに戻る");
  });
});

describe("開発者ホームで利用者を選ぶと、Magic Link でその利用者にログインし、開発者ホームに戻る", () => {
  test("選ぶと、開発者ホームに戻る Magic Link へ 303 で移す", async () => {
    const chosen = await choose(owner.id);

    expect(chosen.status).toBe(303);
    const magicLink = new URL(chosen.headers.get("location") ?? "");
    expect(magicLink.pathname).toBe("/api/auth/magic-link/verify");
    expect(magicLink.searchParams.get("callbackURL")).toBe(DEV_HOME_PATH);
  });

  test("Magic Link を開くと、選んだ利用者の session ができ、開発者ホームはその利用者を出す", async () => {
    const opened = await openMagicLink(await choose(owner.id));
    const headers = browserCookieHeaders(opened);

    expect(opened.status).toBe(302);
    expect(new URL(opened.headers.get("location") ?? "", "http://localhost").pathname).toBe(
      DEV_HOME_PATH,
    );
    expect(await signedInUserIdOf(headers)).toBe(owner.id);
    const body = await openHome(headers);
    expect(signedInSectionOf(body)).toContain(owner.email);
    expect(body).toMatch(new RegExp(`<button type="submit" disabled>[^<]*${owner.email}`));
  });

  test("ログイン中に別の利用者を選ぶと、その利用者の session に切り替わる", async () => {
    const asOwner = await signInAs(owner.id);

    const asAdmin = await signInAs(admin.id, asOwner);

    expect(await signedInUserIdOf(asAdmin)).toBe(admin.id);
    expect(signedInSectionOf(await openHome(asAdmin))).toContain(admin.email);
  });

  test.each([
    ["redirect_url を受けない", ""],
    ["redirect_url を受けた", REDIRECT_QUERY],
  ])("MFA を有効にした利用者を選ぶと、%s時も session を作らず MFA チャレンジへ移す", (_, query) =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("mfa"));
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
    expect(signedInSectionOf(await openHome(afterSignOut))).toContain("ログインしていません");
  });
});

describe("開発者ホームは service_name と redirect_url を受けると、ログインの後に redirect_url へ移す", () => {
  test("redirect_url へ戻る link を出し、ログインとログアウトの送り先に同じ query を付ける", async () => {
    const response = await request(`${DEV_HOME_PATH}${REDIRECT_QUERY}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(
      `<a href="${escapedForHtmlAttribute(REDIRECT_URL)}">アプリケーションに戻る</a>`,
    );
    expect(body).toContain(
      `action="${escapedForHtmlAttribute(`${DEV_HOME_SIGN_IN_PATH}${REDIRECT_QUERY}`)}"`,
    );
    const signedIn = await signInAs(owner.id);
    expect(await openHome(signedIn, REDIRECT_QUERY)).toContain(
      `action="${escapedForHtmlAttribute(`${DEV_HOME_SIGN_OUT_PATH}${REDIRECT_QUERY}`)}"`,
    );
  });

  test("選ぶと redirect_url を callbackURL にした Magic Link へ移し、開くと session ができて query ごと同じ redirect_url へ移る", async () => {
    const chosen = await choose(owner.id, undefined, REDIRECT_QUERY);

    expect(chosen.status).toBe(303);
    expect(new URL(chosen.headers.get("location") ?? "").searchParams.get("callbackURL")).toBe(
      REDIRECT_URL,
    );
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
