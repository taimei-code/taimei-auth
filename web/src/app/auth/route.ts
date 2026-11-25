import { Effect, Option, pipe, Schema, SchemaGetter, SchemaTransformation } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal, slash, Transition } from "foldkit/route";

import { AcceptInvitationSearch } from "@core/invitation/accept-path";
import { ReauthenticationSearch, SignInParams } from "@core/sign-in-params";

import { ErrorPageReason } from "../../auth/auth-error-reason";
import * as SignInOrSignUp from "../../auth/pages/SignInOrSignUp";
import { redirectUrlAfterAccept } from "../../invitation/redirect-target";

const acceptInvitationFields = {
  invitation_token: Schema.UndefinedOr(Schema.String),
  redirect_url: Schema.String,
};

export const AuthRoute = defineRouteUnion({
  SignIn: SignInOrSignUp.Params.fields,
  SignUp: SignInOrSignUp.Params.fields,
  SignUpCompany: SignInOrSignUp.Params.fields,
  Reauthenticate: { redirect_url: Schema.String },
  AcceptInvitation: acceptInvitationFields,
  RejectedSignInParams: {},
  MfaChallenge: {},
  Error: { reason: Schema.Option(ErrorPageReason) },
  NotFound: { path: Schema.String },
});
export type AuthRoute = typeof AuthRoute.Type;

const COMPANY_SIGNUP_FALLBACK: SignInOrSignUp.Params = {
  service_name: "accounts",
  redirect_url: "/account",
};

const decodeSignInParams = Schema.decodeUnknownOption(SignInParams);

const companySignUpSearch = Schema.Record(Schema.String, Schema.String).pipe(
  Schema.decodeTo(
    SignInOrSignUp.Params,
    SchemaTransformation.transform({
      decode: (search) =>
        Option.getOrElse(decodeSignInParams(search), () => COMPANY_SIGNUP_FALLBACK),
      encode: (params) => ({ ...params }),
    }),
  ),
);

const acceptInvitationSearch = AcceptInvitationSearch.pipe(
  Schema.decodeTo(
    Schema.Struct(acceptInvitationFields),
    new SchemaTransformation.Transformation(
      SchemaGetter.transform((search: typeof AcceptInvitationSearch.Type) => ({
        invitation_token: search.invitation_token,
        redirect_url: redirectUrlAfterAccept(search),
      })),
      SchemaGetter.forbidden(
        () =>
          "招待の受諾の URL は acceptInvitationPath で組み立てる (戻り先の組を route の値から戻せない)",
      ),
    ),
  ),
);

export const signInRouter = pipe(
  literal("auth"),
  Route.query(SignInParams),
  Route.mapTo(AuthRoute.SignIn),
);

const signInRejectedRouter = pipe(literal("auth"), Route.mapTo(AuthRoute.RejectedSignInParams));

export const signUpRouter = pipe(
  literal("auth"),
  slash(literal("signup")),
  Route.query(SignInParams),
  Route.mapTo(AuthRoute.SignUp),
);

const signUpRejectedRouter = pipe(
  literal("auth"),
  slash(literal("signup")),
  Route.mapTo(AuthRoute.RejectedSignInParams),
);

const reauthenticateRouter = pipe(
  literal("auth"),
  slash(literal("reauthenticate")),
  Route.query(ReauthenticationSearch),
  Route.mapTo(AuthRoute.Reauthenticate),
);

const reauthenticateRejectedRouter = pipe(
  literal("auth"),
  slash(literal("reauthenticate")),
  Route.mapTo(AuthRoute.RejectedSignInParams),
);

const signUpCompanyRouter = pipe(
  literal("auth"),
  slash(literal("signup")),
  slash(literal("company")),
  Route.query(companySignUpSearch),
  Route.mapTo(AuthRoute.SignUpCompany),
);

const acceptInvitationRouter = pipe(
  literal("auth"),
  slash(literal("signup")),
  slash(literal("accept-invitation")),
  Route.query(acceptInvitationSearch),
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
    reauthenticateRouter,
    reauthenticateRejectedRouter,
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
