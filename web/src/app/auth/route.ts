import { Effect, Option, pipe, Schema } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal, slash, Transition } from "foldkit/route";

import { acceptInvitationSearchSchema } from "@core/invitation/accept-path";
import { type SignInParams, signInParamsSchema } from "@core/sign-in-params";

import { ErrorPageReason } from "../../auth/auth-error-reason";
import * as SignInOrSignUp from "../../auth/pages/SignInOrSignUp";
import { redirectUrlAfterAccept } from "../../invitation/redirect-target";
import { fromZodSearch } from "../zod-search";

export const AuthRoute = defineRouteUnion({
  SignIn: SignInOrSignUp.Params.fields,
  SignUp: SignInOrSignUp.Params.fields,
  SignUpCompany: SignInOrSignUp.Params.fields,
  AcceptInvitation: {
    invitation_token: Schema.UndefinedOr(Schema.String),
    redirect_url: Schema.String,
  },
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

const signUpCompanyRouter = pipe(
  literal("auth"),
  slash(literal("signup")),
  slash(literal("company")),
  Route.query(
    fromZodSearch<SignInParams>(
      signInParamsSchema.catch({ service_name: "accounts", redirect_url: "/account" }),
    ),
  ),
  Route.mapTo(AuthRoute.SignUpCompany),
);

const acceptInvitationRouter = pipe(
  literal("auth"),
  slash(literal("signup")),
  slash(literal("accept-invitation")),
  Route.query(
    fromZodSearch(
      acceptInvitationSearchSchema.transform((search) => ({
        invitation_token: search.invitation_token,
        redirect_url: redirectUrlAfterAccept(search),
      })),
    ),
  ),
  Route.mapTo(AuthRoute.AcceptInvitation),
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
    signUpCompanyRouter,
    acceptInvitationRouter,
    mfaChallengeRouter,
    errorRouter,
  ),
  AuthRoute.NotFound,
);

export const enteredAuthRoute = (
  maybePreviousRoute: Option.Option<AuthRoute>,
  nextRoute: AuthRoute,
): Option.Option<AuthRoute> => Transition.enteredAny({ maybePreviousRoute, nextRoute });
