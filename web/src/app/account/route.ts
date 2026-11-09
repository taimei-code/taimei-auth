import { Equal, Option, pipe, Schema } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal, slash } from "foldkit/route";
import type { z } from "zod";

import { redirectTargetSearchSchema } from "@core/invitation/accept-path";

import { fromZodSearch } from "../zod-search";

export const AccountRoute = defineRouteUnion({
  Profile: {},
  Security: {},
  Sessions: {},
  Connections: {},
  Companies: {},
  Members: {
    service_name: Schema.optional(Schema.String),
    redirect_url: Schema.optional(Schema.String),
  },
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
  Route.query(
    fromZodSearch<z.output<typeof redirectTargetSearchSchema>>(redirectTargetSearchSchema),
  ),
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

export const accountRouteToEnter = (
  maybePreviousRoute: Option.Option<AccountRoute>,
  nextRoute: AccountRoute,
): Option.Option<AccountRoute> =>
  Option.liftPredicate(
    nextRoute,
    (route) =>
      !Option.exists(maybePreviousRoute, (previousRoute) => Equal.equals(previousRoute, route)),
  );
