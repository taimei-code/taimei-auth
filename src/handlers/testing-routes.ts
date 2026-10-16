import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect, Schema } from "effect";
import { type Context, Hono } from "hono";
import { getTrustedOrigins } from "../env";
import { InvalidArgument } from "../membership/guard/errors";
import { createSignedInUser } from "../testing/create-signed-in-user";
import { MagicLinkOutbox } from "../testing/magic-link-outbox";
import { setCurrentCompany } from "../testing/set-current-company";
import { SetCurrentCompanyRequest, SignedInUserRequest } from "../testing/testing-contract";
import { runRoute } from "./run-route";

const decodeBody = <S extends Schema.Top>(c: Context, schema: S) =>
  Effect.tryPromise({ try: () => c.req.json(), catch: () => new InvalidArgument({}) }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new InvalidArgument({})),
  );

const isTrustedReturnTo = (returnTo: string) =>
  URL.canParse(returnTo) && getTrustedOrigins().includes(new URL(returnTo).origin);

export const testingRoutes = (outbox: MagicLinkOutbox["Service"]) =>
  new Hono()
    .post(`${TESTING_PATH}/signed-in-users`, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const body = yield* decodeBody(c, SignedInUserRequest);
          if (!isTrustedReturnTo(body.returnTo)) return yield* new InvalidArgument({});
          const created = yield* createSignedInUser(body).pipe(
            Effect.provideService(MagicLinkOutbox, outbox),
          );
          return c.json(created);
        }),
      ),
    )
    .post(`${TESTING_PATH}/current-company`, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const body = yield* decodeBody(c, SetCurrentCompanyRequest);
          yield* setCurrentCompany(body).pipe(
            Effect.catchTag("Forbidden", () => new InvalidArgument({})),
          );
          return c.json({ ok: true as const });
        }),
      ),
    );
