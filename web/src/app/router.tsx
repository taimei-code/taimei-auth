import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";
import type { ReactNode } from "react";

import {
  ACCEPT_INVITATION_ROUTE,
  acceptInvitationSearchSchema,
  redirectTargetSearchSchema,
} from "@core/invitation/accept-path";

import { companyStateAtom } from "../account/account-atom";
import { accountEntryOf } from "../account/account-entry";
import { CurrentCompanyProvider } from "../account/current-company";
import { Connections } from "../account/pages/Connections";
import { Profile } from "../account/pages/Profile";
import { Security } from "../account/pages/Security";
import { Sessions } from "../account/pages/Sessions";
import { ErrorPage } from "../auth/pages/Error";
import { Companies } from "../company/pages/Companies";
import { CompanySettings } from "../company/pages/CompanySettings";
import { acceptInvitation } from "../invitation/accept-invitation";
import { SignUpAcceptInvitation } from "../invitation/pages/SignUpAcceptInvitation";
import { Members } from "../membership/pages/Members";
import { readResult } from "../shared/atom-runtime";
import { FullScreenLoader } from "../shared/FullScreenLoader";
import { AccountLayout } from "./AccountLayout";
import { redirectFor } from "./route-redirect";
import { parseSearch, stringifySearch } from "./search-params";

const rootRoute = createRootRouteWithContext<{ registry: AtomRegistry.AtomRegistry }>()({
  component: Outlet,
  notFoundComponent: () => <ErrorPage />,
});

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  component: Outlet,
});

const acceptInvitationRoute = createRoute({
  getParentRoute: () => authRoute,
  path: ACCEPT_INVITATION_ROUTE,
  validateSearch: acceptInvitationSearchSchema,
  loaderDeps: ({ search }) => acceptInvitationSearchSchema.parse(search),
  loader: async ({ context, deps, location }) => {
    const entry = await acceptInvitation(context.registry, deps);
    if (entry.kind !== "failed") {
      throw redirectFor(entry, location.href);
    }
    return { message: entry.message };
  },
  component: SignUpAcceptInvitation,
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  beforeLoad: async ({ context, location, abortController }) => {
    const entry = accountEntryOf(
      await readResult(context.registry, companyStateAtom, abortController.signal),
    );
    if (entry.kind !== "show") {
      throw redirectFor(entry, location.href);
    }
  },
  component: function Account() {
    return (
      <CurrentCompanyProvider>
        <AccountLayout />
      </CurrentCompanyProvider>
    );
  },
});

const accountPageRoute = <TPath extends string>(path: TPath, component: () => ReactNode) =>
  createRoute({ getParentRoute: () => accountRoute, path, component });

const membersRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: "/members",
  validateSearch: redirectTargetSearchSchema,
  component: Members,
});

const routeTree = rootRoute.addChildren([
  authRoute.addChildren([acceptInvitationRoute]),
  accountRoute.addChildren([
    accountPageRoute("/", Profile),
    accountPageRoute("/companies", Companies),
    accountPageRoute("/company-settings", CompanySettings),
    membersRoute,
    accountPageRoute("/security", Security),
    accountPageRoute("/sessions", Sessions),
    accountPageRoute("/connections", Connections),
  ]),
]);

export const makeRouter = (registry: AtomRegistry.AtomRegistry) =>
  createRouter({
    routeTree,
    context: { registry },
    trailingSlash: "preserve",
    parseSearch,
    stringifySearch,
    defaultPendingComponent: FullScreenLoader,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
