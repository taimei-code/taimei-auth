import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect, Schema } from "effect";
import { type Context, Hono } from "hono";
import { runRoute } from "../src/handlers/run-route";
import { InvalidArgument } from "../src/membership/guard/errors";
import { createSignedInUser } from "./create-signed-in-user";
import type { MagicLinkOutbox } from "./magic-link-outbox";
import { setCurrentCompany } from "./set-current-company";
import { SetCurrentCompanyRequest, SignedInUserRequest } from "./testing-contract";

const decodeBody = <S extends Schema.Codec<unknown, unknown, never, never>>(
  c: Context,
  schema: S,
) =>
  Effect.tryPromise(() => c.req.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new InvalidArgument({})),
  );

export const testingRoutes = (outbox: MagicLinkOutbox) =>
  new Hono()
    .post(`${TESTING_PATH}/signed-in-users`, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const body = yield* decodeBody(c, SignedInUserRequest);
          return c.json(yield* createSignedInUser(body, outbox));
        }),
      ),
    )
    .post(`${TESTING_PATH}/current-company`, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const body = yield* decodeBody(c, SetCurrentCompanyRequest);
          return c.json(yield* setCurrentCompany(body));
        }),
      ),
    );
