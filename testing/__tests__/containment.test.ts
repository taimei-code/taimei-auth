import { describe, expect, test } from "bun:test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { requireAuthHostOrigin } from "../auth-host-origin";
import { nonProductionRoutes } from "../non-production-routes";
import { recordingEmail } from "../sent-links";

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
