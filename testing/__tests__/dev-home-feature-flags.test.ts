import { beforeAll, describe, expect, test } from "bun:test";
import { DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { DEV_ACCOUNTS } from "../../db/testing/dev-accounts";
import { requireLocalDatabase } from "../../db/testing/local-database";
import { prepareNonProductionTables } from "../../db/testing/non-production-tables";
import { buildApp } from "../../src/app";
import { browserCookieHeaders } from "../../src/__tests__/session-helpers";
import { enabled, FEATURE_FLAGS_BINDING, FeatureFlags } from "../../src/feature-flags";
import { devHomeRoutes } from "../dev-home";
import { fakeFlagship } from "../feature-flags";
import { recordingEmail } from "../sent-links";
import { requestInBrowser } from "./in-browser";
import { AUTH_HOST_ORIGIN, HEADERS_WITHOUT_AUTH_HOST_ORIGIN } from "./origins";
import { devHomePropsOf, pagePropsOf } from "./page-props-of";

const FEATURE_FLAGS_PAGE = `${DEV_HOME_PATH}/feature-flags`;
const COMPANY_FLAG = "example-company-flag";
const [firstCompany, secondCompany] = DEV_ACCOUNTS.companies;
if (!firstCompany || !secondCompany) throw new Error("DEV_ACCOUNTS has fewer than 2 companies");

const localApp = () => {
  const flags = fakeFlagship();
  const app = buildApp({
    mountStatic: (honoApp) =>
      honoApp.route(
        "/",
        devHomeRoutes({
          ...recordingEmail,
          featureFlags: flags,
          flagCatalog: { passkey: "everyone", [COMPANY_FLAG]: "companies" },
        }),
      ),
  });
  return { flags, request: requestInBrowser(app, crypto.randomUUID()) };
};

const stagingApp = () =>
  requestInBrowser(
    buildApp({ mountStatic: (honoApp) => honoApp.route("/", devHomeRoutes(recordingEmail)) }),
    crypto.randomUUID(),
  );

const devEnvironmentApp = () =>
  requestInBrowser(
    buildApp({
      mountStatic: (honoApp) =>
        honoApp.route(
          "/",
          devHomeRoutes({ ...recordingEmail, localFlagStoreApp: FEATURE_FLAGS_BINDING }),
        ),
    }),
    crypto.randomUUID(),
  );

const openFlagsPage = async (request: ReturnType<typeof stagingApp>, headers?: HeadersInit) => {
  const page = pagePropsOf(await (await request(FEATURE_FLAGS_PAGE, { headers })).text());
  if (page._tag !== "FeatureFlags") throw new Error(`${page._tag} is not the feature flags page`);
  return page;
};

const openHome = async (request: ReturnType<typeof stagingApp>, query = "") =>
  devHomePropsOf(await (await request(`${DEV_HOME_PATH}${query}`)).text());

const flagOn = (page: Awaited<ReturnType<typeof openFlagsPage>>, name: string) => {
  const flag = page.flags.find((candidate) => candidate.name === name);
  if (!flag) throw new Error(`${name} is not on the page`);
  return flag;
};

const switchFlag = (
  request: ReturnType<typeof stagingApp>,
  body: Record<string, string>,
  headers: HeadersInit = { origin: AUTH_HOST_ORIGIN },
) => request(FEATURE_FLAGS_PAGE, { method: "POST", headers, body: new URLSearchParams(body) });

const passkeyEvaluated = (flags: ReturnType<typeof fakeFlagship>) =>
  Effect.runPromise(enabled("passkey").pipe(Effect.provide(flags.layer)));

beforeAll(() => prepareNonProductionTables(requireLocalDatabase(process.env.DATABASE_URL)));

describe("ローカルの開発者ホームは、フィーチャーフラグのページを開ける", () => {
  test("開発者ホームは、開いた時の query を引き継いだフィーチャーフラグのページへの link を渡す", async () => {
    const { request } = localApp();
    const query = `?${new URLSearchParams({
      service_name: "accounts",
      redirect_url: "http://localhost:3100/account",
    })}`;

    expect((await openHome(request, query)).featureFlagsHref).toBe(`${FEATURE_FLAGS_PAGE}${query}`);
  });

  test("フィーチャーフラグのページは、一覧のすべてのフラグを、切り替える前は全体 on として渡す", async () => {
    const { request } = localApp();

    const page = await openFlagsPage(request);

    expect(page.flags.map(({ name, status }) => [name, status])).toEqual([
      ["passkey", "On"],
      [COMPANY_FLAG, "On"],
    ]);
  });

  test("作り直したアプリは、前のアプリで全体 off にしたフラグも全体 on から始める", async () => {
    const before = localApp();
    expect((await switchFlag(before.request, { flag: "passkey", state: "off" })).status).toBe(303);
    expect(await passkeyEvaluated(before.flags)).toBe(false);
    const { flags, request } = localApp();

    expect(flagOn(await openFlagsPage(request), "passkey").status).toBe("On");
    expect(await passkeyEvaluated(flags)).toBe(true);
  });
});

describe("フィーチャーフラグのページから切り替えると、server の評価が変わる", () => {
  test("全体 off を送るとページへ 303 で戻って評価が off になり、全体 on を送ると on に戻る", async () => {
    const { flags, request } = localApp();

    const off = await switchFlag(request, { flag: "passkey", state: "off" });

    expect(off.status).toBe(303);
    expect(off.headers.get("location")).toBe(FEATURE_FLAGS_PAGE);
    expect(await passkeyEvaluated(flags)).toBe(false);
    expect(flagOn(await openFlagsPage(request), "passkey").status).toBe("Off");

    await switchFlag(request, { flag: "passkey", state: "on" });

    expect(await passkeyEvaluated(flags)).toBe(true);
  });

  test("事業所で決まるフラグに、DB にある事業所の ID を改行と重複を含めて書くと、事業所だけ on になり、名前を付けて渡す", async () => {
    const { request } = localApp();

    await switchFlag(request, {
      flag: COMPANY_FLAG,
      state: "onlyFor",
      companyIds: `${firstCompany.id}\n${secondCompany.id}\n${firstCompany.id}\n`,
    });

    const flag = flagOn(await openFlagsPage(request), COMPANY_FLAG);
    expect(flag.status).toBe("OnlyFor");
    expect(flag.companies).toEqual([
      { id: firstCompany.id, name: firstCompany.name },
      { id: secondCompany.id, name: secondCompany.name },
    ]);
  });

  test("事業所で決まるフラグを事業所だけ on にすると、server の評価は書いた事業所だけ on になる", async () => {
    const { flags, request } = localApp();

    await switchFlag(request, {
      flag: COMPANY_FLAG,
      state: "onlyFor",
      companyIds: firstCompany.id,
    });

    const evaluated = await Effect.runPromise(
      Effect.forEach(
        [{}, { companyId: firstCompany.id }, { companyId: secondCompany.id }],
        (context) => FeatureFlags.use((each) => each.isOn(COMPANY_FLAG, context)),
      ).pipe(Effect.provide(flags.layer)),
    );
    expect(evaluated).toEqual([false, true, false]);
  });

  test("DB に無い事業所の ID を 1 つでも含めると切り替えず、知らせにその ID を渡す", async () => {
    const { request } = localApp();
    const unknownId = "cmp_not_in_database";

    const rejected = await switchFlag(request, {
      flag: COMPANY_FLAG,
      state: "onlyFor",
      companyIds: `${firstCompany.id}\n${unknownId}`,
    });

    const page = await openFlagsPage(request, browserCookieHeaders(rejected));
    expect(flagOn(page, COMPANY_FLAG).status).toBe("On");
    expect(page.notice).toEqual({ _tag: "UnknownCompanyIds", ids: [unknownId] });
  });

  test("事業所の ID を 1 つも書かずに事業所だけ on を送ると切り替えず、ID が無いことを知らせる", async () => {
    const { request } = localApp();

    const rejected = await switchFlag(request, {
      flag: COMPANY_FLAG,
      state: "onlyFor",
      companyIds: " \n ",
    });

    const page = await openFlagsPage(request, browserCookieHeaders(rejected));
    expect(flagOn(page, COMPANY_FLAG).status).toBe("On");
    expect(page.notice).toEqual({ _tag: "NoCompanyIds" });
  });

  test("ログイン前にも評価する passkey に事業所だけ on を送ると 400 を返し、評価を変えない", async () => {
    const { flags, request } = localApp();

    const response = await switchFlag(request, {
      flag: "passkey",
      state: "onlyFor",
      companyIds: firstCompany.id,
    });

    expect(response.status).toBe(400);
    expect(await passkeyEvaluated(flags)).toBe(true);
  });

  test.each([
    "not-registered",
    "constructor",
  ])("一覧に無いフラグの名前 (%s) を送ると 400 を返す", async (flag) => {
    const { request } = localApp();

    expect((await switchFlag(request, { flag, state: "off" })).status).toBe(400);
  });

  test.each(
    HEADERS_WITHOUT_AUTH_HOST_ORIGIN,
  )("%s の POST は 403 を返し、評価を変えない", async (_label, headers) => {
    const { flags, request } = localApp();

    const response = await switchFlag(request, { flag: "passkey", state: "off" }, headers);

    expect(response.status).toBe(403);
    expect(await passkeyEvaluated(flags)).toBe(true);
  });
});

describe("手元の置き場の app を渡す開発環境の開発者ホームは、フィーチャーフラグの link に、要求と同じ port の localhost の Local Explorer を渡す", () => {
  test.each([
    ["3100", "http://localhost:3100/cdn-cgi/local/explorer/flagship/FLAGS"],
    ["4200", "http://localhost:4200/cdn-cgi/local/explorer/flagship/FLAGS"],
  ])("port %s で開いた開発者ホームは、link に %s を渡す", async (port, localExplorer) => {
    const request = devEnvironmentApp();
    const query = new URLSearchParams({
      service_name: "accounts",
      redirect_url: "http://localhost:3100/account",
    });

    const home = devHomePropsOf(
      await (
        await request(`http://auth.taimei-code.localhost:${port}${DEV_HOME_PATH}?${query}`)
      ).text(),
    );

    expect(home.featureFlagsHref).toBe(localExplorer);
  });

  test("開発者ホームのフィーチャーフラグのページは載せず、GET と POST は 404 を返す", async () => {
    const request = devEnvironmentApp();

    expect((await request(FEATURE_FLAGS_PAGE)).status).toBe(404);
    expect((await switchFlag(request, { flag: "passkey", state: "off" })).status).toBe(404);
  });
});

describe("偽物の Flagship も手元の置き場の app も渡さない入口 (staging) には、フィーチャーフラグのページも link も無い", () => {
  test("ページの GET と POST は 404 で、開発者ホームに link を渡さない", async () => {
    const request = stagingApp();

    expect((await request(FEATURE_FLAGS_PAGE)).status).toBe(404);
    expect((await switchFlag(request, { flag: "passkey", state: "off" })).status).toBe(404);
    expect((await openHome(request)).featureFlagsHref).toBeNull();
  });
});
