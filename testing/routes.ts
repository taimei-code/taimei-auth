import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { Hono } from "hono";
import { runRoute } from "../src/handlers/run-route";
import { createSignedInUser } from "./create-signed-in-user";
import { decodeJsonBody } from "./decode-body";
import type { FakeFlagship } from "./feature-flags";
import { setCurrentCompany } from "./set-current-company";
import {
  FeatureFlagSwitchRequest,
  SetCurrentCompanyRequest,
  SignedInUserRequest,
} from "./testing-contract";

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

export const featureFlagRoutes = (featureFlags: FakeFlagship) =>
  new Hono().post(`${TESTING_PATH}/feature-flags`, (c) =>
    runRoute(
      c,
      Effect.gen(function* () {
        const request = yield* decodeJsonBody(c, FeatureFlagSwitchRequest);
        featureFlags.switchFlag(request);
        return c.json({ ok: true as const });
      }),
    ),
  );
