import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { Hono } from "hono";
import { runRoute } from "../src/handlers/run-route";
import { createSignedInUser } from "./create-signed-in-user";
import { decodeJsonBody } from "./decode-body";
import { setCurrentCompany } from "./set-current-company";
import { SetCurrentCompanyRequest, SignedInUserRequest } from "./testing-contract";

export const testingApiRoutes = () =>
  new Hono()
    .post(`${TESTING_PATH}/signed-in-users`, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(c, SignedInUserRequest);
          return c.json(yield* createSignedInUser(body));
        }),
      ),
    )
    .post(`${TESTING_PATH}/current-company`, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(c, SetCurrentCompanyRequest);
          return c.json(yield* setCurrentCompany(body));
        }),
      ),
    );
