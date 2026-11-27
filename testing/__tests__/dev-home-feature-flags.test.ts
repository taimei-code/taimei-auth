import { beforeAll, describe, expect, test } from "bun:test";
import { DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import { Record } from "effect";
import { requireLocalDatabase } from "../../db/testing/local-database";
import { prepareNonProductionTables } from "../../db/testing/non-production-tables";
import { buildApp } from "../../src/app";
import { FEATURE_FLAGS_BINDING } from "../../src/feature-flags";
import { devHomeRoutes } from "../dev-home";
import { FEATURE_FLAG_CATALOG } from "../feature-flag-catalog";
import { fakeFlagship } from "../feature-flags";
import { mountNonProductionRoutes } from "../non-production-routes";
import { recordingEmail } from "../sent-links";
import { requestInBrowser } from "./in-browser";
import { AUTH_HOST_ORIGIN } from "./origins";
import { devHomePropsOf } from "./page-props-of";

const [REGISTERED_FLAG] = Record.keys(FEATURE_FLAG_CATALOG);

const FEATURE_FLAGS_PAGE = `${DEV_HOME_PATH}/feature-flags`;

const appWith = (mountStatic: Parameters<typeof buildApp>[0]["mountStatic"]) =>
  requestInBrowser(buildApp({ mountStatic }), crypto.randomUUID());

const devEnvironmentApp = () =>
  appWith((honoApp) =>
    honoApp.route(
      "/",
      devHomeRoutes({ ...recordingEmail, localFlagStoreApp: FEATURE_FLAGS_BINDING }),
    ),
  );

const stagingApp = () => appWith((honoApp) => honoApp.route("/", devHomeRoutes(recordingEmail)));

const e2eEntryApp = () =>
  appWith(
    mountNonProductionRoutes({
      recordsEmailTo: recordingEmail.recordsEmailTo,
      featureFlags: fakeFlagship(),
    }),
  );

beforeAll(() => prepareNonProductionTables(requireLocalDatabase(process.env.DATABASE_URL)));

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
});

describe("どの入口の本番以外の route にも、開発者ホームのフィーチャーフラグのページの route が無い", () => {
  test.each([
    ["開発環境", devEnvironmentApp],
    ["staging", stagingApp],
    ["偽物の Flagship を渡す E2E", e2eEntryApp],
  ])("%s の入口の route は、ページの GET と、auth ホストの Origin から送った POST に 404 を返す", async (_, app) => {
    const request = app();

    expect((await request(FEATURE_FLAGS_PAGE)).status).toBe(404);
    expect(
      (
        await request(FEATURE_FLAGS_PAGE, {
          method: "POST",
          headers: { origin: AUTH_HOST_ORIGIN },
          body: new URLSearchParams({ flag: REGISTERED_FLAG, state: "off" }),
        })
      ).status,
    ).toBe(404);
  });
});

describe("手元の置き場の app を渡さない入口の開発者ホームは、フィーチャーフラグの link を出さない", () => {
  test.each([
    ["staging", stagingApp],
    ["偽物の Flagship を渡す E2E", e2eEntryApp],
  ])("%s の入口の開発者ホームの page props に、フィーチャーフラグの link が無い", async (_, app) => {
    const home = devHomePropsOf(await (await app()(DEV_HOME_PATH)).text());

    expect(home.featureFlagsHref).toBeNull();
  });
});
