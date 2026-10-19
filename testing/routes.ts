import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect, Schema } from "effect";
import { Hono } from "hono";
import { runRoute } from "../src/handlers/run-route";
import { InvalidArgument } from "../src/membership/guard/errors";
import { createSignedInUser } from "./create-signed-in-user";
import type { MagicLinkOutbox } from "./magic-link-outbox";
import { SignedInUserRequest } from "./testing-contract";

export const testingRoutes = (outbox: MagicLinkOutbox) =>
  new Hono().post(`${TESTING_PATH}/signed-in-users`, (c) =>
    runRoute(
      c,
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise(() => c.req.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SignedInUserRequest)),
          Effect.mapError(() => new InvalidArgument({})),
        );
        return c.json(yield* createSignedInUser(body, outbox));
      }),
    ),
  );
