import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { Hono } from "hono";
import { runRoute } from "../src/handlers/run-route";
import { accountPickerRoutes } from "./account-picker";
import { createSignedInUser } from "./create-signed-in-user";
import { decodeBody } from "./decode-body";
import { setCurrentCompany } from "./set-current-company";
import { SetCurrentCompanyRequest, SignedInUserRequest } from "./testing-contract";

export const testingRoutes = () =>
  new Hono()
    .post(`${TESTING_PATH}/signed-in-users`, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const body = yield* decodeBody(() => c.req.json(), SignedInUserRequest);
          return c.json(yield* createSignedInUser(body));
        }),
      ),
    )
    .post(`${TESTING_PATH}/current-company`, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const body = yield* decodeBody(() => c.req.json(), SetCurrentCompanyRequest);
          return c.json(yield* setCurrentCompany(body));
        }),
      ),
    )
    .route("/", accountPickerRoutes());
