import { Effect, Option, pipe, Schema } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal, slash } from "foldkit/route";

import { ErrorPageReason } from "../../auth/auth-error-reason";

export const AuthRoute = defineRouteUnion({
  Error: { reason: Schema.Option(ErrorPageReason) },
  NotFound: { path: Schema.String },
});

const errorRouter = pipe(
  literal("auth"),
  slash(literal("error")),
  Route.query(
    Schema.Struct({ reason: Schema.OptionFromOptional(ErrorPageReason) }).pipe(
      Schema.catchDecoding(() => Effect.succeedSome({ reason: Option.none() })),
    ),
  ),
  Route.mapTo(AuthRoute.Error),
);

export const urlToAuthRoute = Route.parseUrlWithFallback(errorRouter, AuthRoute.NotFound);
