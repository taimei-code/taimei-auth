import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDevHomeUrl, TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import type { Hono } from "hono";
import { DEV_ACCOUNTS, seedDevAccounts } from "../../db/testing/dev-accounts";
import { buildApp } from "../../src/app";
import { auth } from "../../src/auth";
import { REPO_ROOT } from "../../src/__tests__/config-invariant-helpers";
import { dbTest } from "../../src/__tests__/live-runner";
import { browserCookieHeaders } from "../../src/__tests__/session-helpers";
import { TestDb } from "../../src/__tests__/test-db";
import { DEV_SIGN_IN_PATH, devHomeRoutes } from "../dev-home";
import { testingRoutes } from "../routes";

const P = "dev-home-test-";
const { run, cleanup } = dbTest(P);

const SPA_RESPONSE = "spa index.html";
const REDIRECT_URL = "http://localhost:3100/account";
const RETURN_QUERY = `?${new URLSearchParams({ service_name: "accounts", redirect_url: REDIRECT_URL })}`;
const DISALLOWED_QUERY = `?${new URLSearchParams({ service_name: "accounts", redirect_url: "https://evil.example/" })}`;
const NESTED_QUERY = `?${new URLSearchParams({ service_name: "accounts", redirect_url: `${REDIRECT_URL}?tab=a&next=%2Fx` })}`;
const SERVICE_ONLY_QUERY = "?service_name=accounts";
const INVALID_REDIRECT_URL_PAGE = "/auth/error?reason=invalid_redirect_url";

const appWith = (mount: (app: Hono) => void) =>
  buildApp({
    mountStatic: (honoApp) => {
      mount(honoApp);
      honoApp.use("/auth/*", async (c) => c.text(SPA_RESPONSE));
    },
  });

const testingApp = appWith((app) => {
  app.route("/", testingRoutes());
  app.route("/", devHomeRoutes());
});
const productionLikeApp = appWith(() => {});

const request = (path: string, init?: RequestInit, app = testingApp) =>
  Promise.resolve(app.request(path, init));

const devHomePathOf = (url: string) => {
  const { pathname, search } = new URL(url);
  return `${pathname}${search}`;
};

const DEV_HOME_WITH_RETURN = devHomePathOf(
  buildDevHomeUrl({
    authBaseUrl: "http://localhost:3100",
    service: "accounts",
    returnTo: REDIRECT_URL,
  }),
);

const openDevHome = async (path = DEV_HOME_WITH_RETURN, headers?: HeadersInit) => {
  const response = await request(path, { headers });
  return { response, body: await response.text() };
};

const selectUser = (userId: string | undefined, query = RETURN_QUERY, headers?: HeadersInit) =>
  request(`/dev/sign-in${query}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(userId === undefined ? {} : { userId }),
  });

const openMagicLink = (location: string, headers?: HeadersInit) => {
  const magicLink = new URL(location);
  return request(`${magicLink.pathname}${magicLink.search}`, { headers });
};

const signInAs = async (userId: string, headers?: HeadersInit) => {
  const selected = await selectUser(userId, RETURN_QUERY, headers);
  return openMagicLink(selected.headers.get("location") ?? "", headers);
};

const signOut = (query = RETURN_QUERY, headers?: HeadersInit) =>
  request(`/dev/sign-out${query}`, { method: "POST", headers });

const sessionUserIdOf = async (headers: HeadersInit) => {
  const session = (await (await request("/api/auth/get-session", { headers })).json()) as {
    user: { id: string };
  } | null;
  return session?.user.id ?? null;
};

const sessionTokenOnly = (headers: Headers) =>
  new Headers({
    cookie: (headers.get("cookie") ?? "")
      .split("; ")
      .filter((cookie) => cookie.includes("session_token="))
      .join("; "),
  });

const unescapeAmpersands = (value: string) => value.replaceAll("&amp;", "&");

const optgroupsOf = (body: string) =>
  Object.fromEntries(
    [...body.matchAll(/<optgroup label="([^"]*)">([\s\S]*?)<\/optgroup>/g)].map(
      ([, label, inner]) => [
        label,
        [...(inner ?? "").matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(([, text]) => text),
      ],
    ),
  );

const optionTagsOf = (body: string) =>
  [...body.matchAll(/<option[^>]*>[^<]*<\/option>/g)].map(([tag]) => tag);

const dataActionsOf = (body: string) =>
  Object.fromEntries(
    [...body.matchAll(/<option[^>]*data-action="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(
      ([, action, text]) => [text, unescapeAmpersands(action ?? "")],
    ),
  );

const linksOf = (body: string) =>
  [...body.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map(([, href, text]) => ({
    href: unescapeAmpersands(href ?? ""),
    text,
  }));

const [owner, admin] = DEV_ACCOUNTS.users;
if (!owner || !admin) throw new Error("DEV_ACCOUNTS has no owner or admin");
const [firstCompany, secondCompany] = DEV_ACCOUNTS.companies;
if (!firstCompany || !secondCompany) throw new Error("DEV_ACCOUNTS has fewer than 2 companies");

beforeAll(seedDevAccounts);
beforeEach(cleanup);
afterAll(cleanup);

describe("試験の環境の共通ログイン画面と共通サインアップ画面は、本番と同じ画面を出す", () => {
  test.each([
    ["共通ログイン画面", `/auth/${RETURN_QUERY}`],
    ["共通サインアップ画面", `/auth/signup${RETURN_QUERY}`],
  ])("未ログインで開いた%sは、試験の route を載せない app と同じ応答を返す", async (_, path) => {
    const [testing, production] = await Promise.all([
      request(path),
      request(path, undefined, productionLikeApp),
    ]);

    expect({ status: testing.status, body: await testing.text() }).toEqual({
      status: production.status,
      body: await production.text(),
    });
    expect(testing.status).toBe(200);
  });

  test("ログイン済みで開いた共通ログイン画面は、試験の route を載せない app と同じく redirect_url へ移す", async () => {
    const cookies = browserCookieHeaders(await signInAs(owner.id));

    const [testing, production] = await Promise.all([
      request(`/auth/${RETURN_QUERY}`, { headers: cookies }),
      request(`/auth/${RETURN_QUERY}`, { headers: cookies }, productionLikeApp),
    ]);

    expect([testing.status, testing.headers.get("location")]).toEqual([302, REDIRECT_URL]);
    expect([production.status, production.headers.get("location")]).toEqual([302, REDIRECT_URL]);
  });

  test("試験 API の path に、アカウントを選ぶ送り先が無い", async () => {
    const response = await request(`${TESTING_PATH}/account-picker${RETURN_QUERY}`, {
      method: "POST",
      body: new URLSearchParams({ userId: owner.id }),
    });

    expect(response.status).toBe(404);
  });

  test("試験 API の route の集まりに、開発者ホームが無い", async () => {
    const onlyTestingApi = appWith((app) => {
      app.route("/", testingRoutes());
    });

    expect((await request("/dev", undefined, onlyTestingApi)).status).toBe(404);
  });
});

describe("開発者ホームは、ログインしている利用者を出す", () => {
  test("buildDevHomeUrl の URL を未ログインで開くと、「ログインしていません」を出す", async () => {
    const { response, body } = await openDevHome();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("text/html");
    expect(body).toContain("ログインしていません");
  });

  test("ログイン中なら、名前・メール・所属する事業所と role を出し、現在の事業所に印を付ける", async () => {
    const cookies = browserCookieHeaders(await signInAs(owner.id));

    const { body } = await openDevHome(DEV_HOME_WITH_RETURN, cookies);

    expect(body).not.toContain("ログインしていません");
    expect(body).toContain(owner.name);
    expect(body).toContain(owner.email);
    const companyRows = [...body.matchAll(/<li>([^<]*)<\/li>/g)].map(([, row]) => row ?? "");
    expect(companyRows).toEqual([
      `${firstCompany.name}: OWNER (現在の事業所)`,
      `${secondCompany.name}: OWNER`,
    ]);
  });

  test("利用者の名前に HTML があっても、escape して出す", () =>
    run(
      Effect.gen(function* () {
        const html = yield* TestDb.use((db) =>
          db.seedUser("html", { name: "<script>alert(1)</script>" }),
        );
        const cookies = browserCookieHeaders(yield* Effect.promise(() => signInAs(html.id)));

        const { body } = yield* Effect.promise(() => openDevHome(DEV_HOME_WITH_RETURN, cookies));

        expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(body).not.toContain("<script>alert(1)");
      }),
    ));
});

describe("開発者ホームのドロップダウンは、メールアドレスを 3 つのまとまりに分けて出す", () => {
  test("開発用アカウントと試験で作った利用者を分け、項目にメールアドレスだけを出す", () =>
    run(
      Effect.gen(function* () {
        const other = yield* TestDb.use((db) => db.seedUser("other"));

        const { body } = yield* Effect.promise(() => openDevHome());

        const groups = optgroupsOf(body);
        expect(groups["開発用アカウント"]).toEqual(DEV_ACCOUNTS.users.map((u) => u.email));
        expect(groups["試験で作った利用者"]).toContain(other.email);
        expect(groups["試験で作った利用者"]).not.toContain(owner.email);
      }),
    ));

  test("ログイン中は、ログアウトのまとまりを出し、ログイン中の利用者を選んだ状態にする", async () => {
    const cookies = browserCookieHeaders(await signInAs(owner.id));

    const { body } = await openDevHome(DEV_HOME_WITH_RETURN, cookies);

    expect(optgroupsOf(body)["ログアウト"]).toEqual(["ログアウトする"]);
    expect(optionTagsOf(body).filter((tag) => /\sselected[\s>]/.test(tag))).toEqual([
      expect.stringContaining(`>${owner.email}</option>`),
    ]);
  });

  test("未ログインなら、ログアウトのまとまりを出さず、「利用者を選ぶ」を選んだ状態にする", async () => {
    const { body } = await openDevHome();

    expect(optgroupsOf(body)["ログアウト"]).toBeUndefined();
    expect(optionTagsOf(body)[0]).toBe('<option value="" selected disabled>利用者を選ぶ</option>');
  });

  test("項目は、開いた時の query を付けた /dev/sign-in か /dev/sign-out を送り先に持ち、選ぶとすぐ送る", async () => {
    const cookies = browserCookieHeaders(await signInAs(owner.id));

    const { body } = await openDevHome(DEV_HOME_WITH_RETURN, cookies);

    const actions = dataActionsOf(body);
    expect(actions[owner.email]).toBe(`/dev/sign-in${RETURN_QUERY}`);
    expect(actions[admin.email]).toBe(`/dev/sign-in${RETURN_QUERY}`);
    expect(actions["ログアウトする"]).toBe(`/dev/sign-out${RETURN_QUERY}`);
    expect(body).toContain(
      'onchange="this.form.action = this.selectedOptions[0].dataset.action; this.form.submit()"',
    );
  });
});

describe("開発者ホームで選んだ利用者は、本物の Magic Link でログインして開発者ホームに戻る", () => {
  test("利用者を選ぶと、Magic Link へ 303 で移し、開くと session cookie が付いて開発者ホームに戻る", async () => {
    const selected = await selectUser(owner.id);

    expect(selected.status).toBe(303);
    const location = selected.headers.get("location") ?? "";
    expect(location).toStartWith(
      `${process.env.AUTH_SERVICE_URL}/api/auth/magic-link/verify?token=`,
    );
    const opened = await openMagicLink(location);
    expect(opened.headers.get("set-cookie")).toContain("session_token=");
    const landed = new URL(opened.headers.get("location") ?? "", "http://x");
    expect(landed.pathname).toBe("/dev");
    expect([...landed.searchParams]).toEqual([...new URLSearchParams(RETURN_QUERY)]);
  });

  test.each([
    ["encode した", NESTED_QUERY],
    ["browser の address bar に打った形の", `?service_name=accounts&redirect_url=${REDIRECT_URL}`],
    ["空の", ""],
  ])("%s query で選んでも、Magic Link の callbackURL は verify の trusted origin の検査を通る (better-auth は bun test の中で検査を切るので、verify と同じく 1 回 decode して検査の関数を直接呼ぶ)", async (_, query) => {
    const selected = await selectUser(owner.id, query);

    const callbackURL =
      new URL(selected.headers.get("location") ?? "").searchParams.get("callbackURL") ?? "";

    expect(
      (await auth.$context).isTrustedOrigin(decodeURIComponent(callbackURL), {
        allowRelativePaths: true,
      }),
    ).toBe(true);
  });

  test("redirect_url が自分の query を持っていても、ログインの後の開発者ホームは同じ redirect_url を受け取る (better-auth は Magic Link の callbackURL を 2 回 decode する)", async () => {
    const selected = await selectUser(owner.id, NESTED_QUERY);

    const opened = await openMagicLink(selected.headers.get("location") ?? "");

    const landed = new URL(opened.headers.get("location") ?? "", "http://x");
    expect(landed.pathname).toBe("/dev");
    expect([...landed.searchParams]).toEqual([...new URLSearchParams(NESTED_QUERY)]);
  });

  test("ログイン中に別の利用者を選ぶと、その利用者の session に替わる", async () => {
    const ownerCookies = browserCookieHeaders(await signInAs(owner.id));

    const switched = browserCookieHeaders(await signInAs(admin.id, ownerCookies));

    expect(await sessionUserIdOf(switched)).toBe(admin.id);
  });

  test("いない利用者を選ぶと 404", async () => {
    expect((await selectUser("missing-user")).status).toBe(404);
  });

  test("利用者を送らないと 400", async () => {
    expect((await selectUser(undefined)).status).toBe(400);
  });

  test("redirect_url が許可されない query で選ぶと 400", async () => {
    expect((await selectUser(owner.id, DISALLOWED_QUERY)).status).toBe(400);
  });
});

describe("開発者ホームのログアウトは、session cookie を消して開発者ホームに戻る", () => {
  test("ログイン中にログアウトすると、session cookie を消す Set-Cookie を付けて開発者ホームへ 303 で移し、元の session token では session を引けない (session の cookie cache を送らずに確かめる)", async () => {
    const cookies = browserCookieHeaders(await signInAs(owner.id));

    const response = await signOut(RETURN_QUERY, cookies);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/dev${RETURN_QUERY}`);
    expect(
      response.headers
        .getSetCookie()
        .filter((cookie) => cookie.includes("session_token=;") && /max-age=0/i.test(cookie)),
    ).toHaveLength(1);
    expect(await sessionUserIdOf(sessionTokenOnly(cookies))).toBeNull();
  });

  test("cookie が無くても、開発者ホームへ 303 で移す", async () => {
    const response = await signOut();

    expect([response.status, response.headers.get("location")]).toEqual([
      303,
      `/dev${RETURN_QUERY}`,
    ]);
  });

  test("redirect_url が許可されない query でログアウトすると 400", async () => {
    expect((await signOut(DISALLOWED_QUERY)).status).toBe(400);
  });
});

describe("開発者ホームの戻り先は、開いた時の query で決まる", () => {
  test("redirect_url があれば、「アプリケーションに戻る」で redirect_url を開く", async () => {
    const { body } = await openDevHome();

    expect(linksOf(body)).toContainEqual({ href: REDIRECT_URL, text: "アプリケーションに戻る" });
  });

  test("query が無ければ、「アカウント管理画面を開く」で /account を開く", async () => {
    const { body } = await openDevHome("/dev");

    expect(linksOf(body)).toContainEqual({ href: "/account", text: "アカウント管理画面を開く" });
    expect(body).not.toContain("アプリケーションに戻る");
  });

  test.each([
    ["redirect_url が許可されない", DISALLOWED_QUERY],
    ["service_name だけの", SERVICE_ONLY_QUERY],
  ])("%s query で開くと、エラー画面へ移す", async (_, query) => {
    const { response } = await openDevHome(`/dev${query}`);

    expect([response.status, response.headers.get("location")]).toEqual([
      302,
      INVALID_REDIRECT_URL_PAGE,
    ]);
  });
});

describe("本番の bundle の検査は、開発者ホームのログインの送り先を探す", () => {
  test("検査が探す文字列は、開発者ホームのログインの route と同じ", () => {
    const scriptPath = readFileSync(
      join(REPO_ROOT, "scripts/check-production-bundle.sh"),
      "utf8",
    ).match(/^dev_home_sign_in_path="([^"]*)"$/m)?.[1];

    expect(scriptPath).toBe(DEV_SIGN_IN_PATH);
  });

  test("開発者ホームの module を bundle した worker.js を、本番の bundle の検査が止める", async () => {
    const outdir = mkdtempSync(join(tmpdir(), "dev-home-bundle-"));
    try {
      const built = await Bun.build({
        entrypoints: [join(REPO_ROOT, "testing/dev-home.ts")],
        outdir,
        naming: "worker.js",
        packages: "external",
      });
      expect(built.success).toBe(true);

      const checked = Bun.spawnSync([
        "bash",
        join(REPO_ROOT, "scripts/check-production-bundle.sh"),
        outdir,
      ]);

      expect(checked.exitCode).not.toBe(0);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
