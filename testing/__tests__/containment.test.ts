import { describe, expect, test } from "bun:test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { grepFiles, grepLines, SOURCE_ROOTS } from "../../src/__tests__/source-scan";
import { requireAuthHostOrigin } from "../auth-host-origin";
import { nonProductionRoutes } from "../non-production-routes";
import { recordingEmail } from "../sent-links";

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
    const routes = nonProductionRoutes({
      e2eLoginLinks: true,
      recordsEmailTo: recordingEmail.recordsEmailTo,
    })
      .flatMap((app) => app.routes)
      .filter((route) => route.method !== "GET");
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

describe("本番以外の入口が動いてよい APP_ENV の判定は isOutsideProduction の 1 本に閉じる", () => {
  test("testing/ で APP_ENV を読むのは、判定の file と isOutsideProduction に渡す行だけ", () => {
    const readers = grepLines("APP_ENV", "testing", { tests: "exclude" }).filter(
      (hit) =>
        !hit.startsWith("testing/serve-only-outside-production.ts:") &&
        !hit.includes("isOutsideProduction(process.env.APP_ENV)"),
    );
    expect(readers).toEqual([]);
  });
});
