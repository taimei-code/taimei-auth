import { Effect, Option, pipe, Schema } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal, slash, Transition } from "foldkit/route";

import { type SignInParams, signInParamsSchema } from "@core/sign-in-params";

import { ErrorPageReason } from "../../auth/auth-error-reason";
import * as SignInOrSignUp from "../../auth/pages/SignInOrSignUp";
import { fromZodSearch } from "../zod-search";

export const AuthRoute = defineRouteUnion({
  SignIn: SignInOrSignUp.Params.fields,
  SignUp: SignInOrSignUp.Params.fields,
  RejectedSignInParams: {},
  MfaChallenge: {},
  Error: { reason: Schema.Option(ErrorPageReason) },
  NotFound: { path: Schema.String },
});
export type AuthRoute = typeof AuthRoute.Type;

const signInSearch = fromZodSearch<SignInParams>(signInParamsSchema);

export const signInRouter = pipe(
  literal("auth"),
  Route.query(signInSearch),
  Route.mapTo(AuthRoute.SignIn),
);

const signInRejectedRouter = pipe(literal("auth"), Route.mapTo(AuthRoute.RejectedSignInParams));

export const signUpRouter = pipe(
  literal("auth"),
  slash(literal("signup")),
  Route.query(signInSearch),
  Route.mapTo(AuthRoute.SignUp),
);

const signUpRejectedRouter = pipe(
  literal("auth"),
  slash(literal("signup")),
  Route.mapTo(AuthRoute.RejectedSignInParams),
);

const mfaChallengeRouter = pipe(
  literal("auth"),
  slash(literal("mfa")),
  Route.mapTo(AuthRoute.MfaChallenge),
);

export const errorRouter = pipe(
  literal("auth"),
  slash(literal("error")),
  Route.query(
    Schema.Struct({ reason: Schema.OptionFromOptional(ErrorPageReason) }).pipe(
      Schema.catchDecoding(() => Effect.succeedSome({ reason: Option.none() })),
    ),
  ),
  Route.mapTo(AuthRoute.Error),
);

export const urlToAuthRoute = Route.parseUrlWithFallback(
  Route.oneOf(
    signInRouter,
    signInRejectedRouter,
    signUpRouter,
    signUpRejectedRouter,
    mfaChallengeRouter,
    errorRouter,
  ),
  AuthRoute.NotFound,
);

export const enteredAuthRoute = (
  maybePreviousRoute: Option.Option<AuthRoute>,
  nextRoute: AuthRoute,
): Option.Option<AuthRoute> => Transition.enteredAny({ maybePreviousRoute, nextRoute });
