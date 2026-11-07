import { pipe, Schema } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal, slash } from "foldkit/route";

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

const accountPath = (segment: string) => pipe(literal("account"), slash(literal(segment)));

export const profileRouter = pipe(literal("account"), Route.mapTo(AccountRoute.Profile));
export const securityRouter = pipe(accountPath("security"), Route.mapTo(AccountRoute.Security));
export const sessionsRouter = pipe(accountPath("sessions"), Route.mapTo(AccountRoute.Sessions));
export const connectionsRouter = pipe(
  accountPath("connections"),
  Route.mapTo(AccountRoute.Connections),
);
export const companiesRouter = pipe(accountPath("companies"), Route.mapTo(AccountRoute.Companies));
export const membersRouter = pipe(accountPath("members"), Route.mapTo(AccountRoute.Members));
export const companySettingsRouter = pipe(
  accountPath("company-settings"),
  Route.mapTo(AccountRoute.CompanySettings),
);

export const urlToAccountRoute = Route.parseUrlWithFallback(
  Route.oneOf(
    securityRouter,
    sessionsRouter,
    connectionsRouter,
    companiesRouter,
    membersRouter,
    companySettingsRouter,
    profileRouter,
  ),
  AccountRoute.NotFound,
);
