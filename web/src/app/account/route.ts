import { type Option, pipe, Schema } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal, slash, Transition } from "foldkit/route";

export const AccountRoute = defineRouteUnion({
  Profile: {},
  Security: {},
  Sessions: {},
  Connections: {},
  Companies: {},
  Members: {},
  CompanySettings: {},
  NotFound: { path: Schema.String },
});
export type AccountRoute = typeof AccountRoute.Type;

export const profileRouter = pipe(literal("account"), Route.mapTo(AccountRoute.Profile));

export const securityRouter = pipe(
  literal("account"),
  slash(literal("security")),
  Route.mapTo(AccountRoute.Security),
);

export const sessionsRouter = pipe(
  literal("account"),
  slash(literal("sessions")),
  Route.mapTo(AccountRoute.Sessions),
);

export const connectionsRouter = pipe(
  literal("account"),
  slash(literal("connections")),
  Route.mapTo(AccountRoute.Connections),
);

export const companiesRouter = pipe(
  literal("account"),
  slash(literal("companies")),
  Route.mapTo(AccountRoute.Companies),
);

export const membersRouter = pipe(
  literal("account"),
  slash(literal("members")),
  Route.mapTo(AccountRoute.Members),
);

export const companySettingsRouter = pipe(
  literal("account"),
  slash(literal("company-settings")),
  Route.mapTo(AccountRoute.CompanySettings),
);

export const urlToAccountRoute = Route.parseUrlWithFallback(
  Route.oneOf(
    profileRouter,
    securityRouter,
    sessionsRouter,
    connectionsRouter,
    companiesRouter,
    membersRouter,
    companySettingsRouter,
  ),
  AccountRoute.NotFound,
);

export const enteredAccountRoute = (
  maybePreviousRoute: Option.Option<AccountRoute>,
  nextRoute: AccountRoute,
): Option.Option<AccountRoute> => Transition.enteredAny({ maybePreviousRoute, nextRoute });
