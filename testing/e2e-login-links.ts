import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { Hono } from "hono";
import { runRoute } from "../src/handlers/run-route";
import { decodeJsonBody } from "./decode-body";
import { magicLinkUrlFor } from "./sent-links";
import { LoginLinkRequest } from "./testing-contract";

export const E2E_LOGIN_LINKS_DEFINE = "TAIMEI_AUTH_E2E_LOGIN_LINKS";

declare const TAIMEI_AUTH_E2E_LOGIN_LINKS: boolean | undefined;

export const e2eLoginLinksEnabled = (): boolean =>
  typeof TAIMEI_AUTH_E2E_LOGIN_LINKS !== "undefined" && TAIMEI_AUTH_E2E_LOGIN_LINKS === true;

export const e2eLoginLinkRoutes = () =>
  new Hono().post(`${TESTING_PATH}/login-links`, (c) =>
    runRoute(
      c,
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(c, LoginLinkRequest);
        return c.json({ loginUrl: yield* magicLinkUrlFor(body.email, body.returnTo) });
      }),
    ),
  );
