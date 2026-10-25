import { describe, expect, test } from "bun:test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { grepFiles, SOURCE_ROOTS } from "../../src/__tests__/source-scan";
import { requireAuthHostOrigin } from "../auth-host-origin";
import { devHomeRoutes } from "../dev-home";
import { e2eLoginLinkRoutes } from "../e2e-login-links";
import { testingApiAndAccountPickerRoutes } from "../routes";

describe("資格情報なしに user を作る経路は試験の use-case に閉じる", () => {
  test("AuthApi.createUser を呼ぶのは、試験の利用者を作る use-case だけ", () => {
    const callers = SOURCE_ROOTS.flatMap((root) =>
      grepFiles("(^|[^A-Za-z0-9_$])createUser\\(", root, { tests: "exclude" }),
    );
    expect(callers.sort()).toEqual([
      "src/auth-service.ts",
      "src/auth-wiring.ts",
      "testing/create-signed-in-user.ts",
    ]);
  });
});

describe("本番以外の route の POST は、auth ホストの Origin を確かめる", () => {
  test("Origin を確かめない POST は、server から JSON で呼ぶ試験 API だけ", () => {
    const routes = [
      ...testingApiAndAccountPickerRoutes().routes,
      ...devHomeRoutes().routes,
      ...e2eLoginLinkRoutes().routes,
    ].filter((route) => route.method !== "GET");
    const routeKey = (route: (typeof routes)[number]) => `${route.method} ${route.path}`;
    const routesCheckingOrigin = new Set(
      routes.filter((route) => route.handler === requireAuthHostOrigin).map(routeKey),
    );
    const routesNotCheckingOrigin = [...new Set(routes.map(routeKey))].filter(
      (key) => !routesCheckingOrigin.has(key),
    );

    expect(routesNotCheckingOrigin.sort()).toEqual([
      `POST ${TESTING_PATH}/current-company`,
      `POST ${TESTING_PATH}/login-links`,
      `POST ${TESTING_PATH}/signed-in-users`,
    ]);
  });
});
