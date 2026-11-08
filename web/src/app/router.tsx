import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";

import { redirectTargetSearchSchema } from "@core/invitation/accept-path";

import { CurrentCompanyProvider } from "../account/current-company-context";
import { ErrorPage } from "../auth/pages/Error";
import { Members } from "../membership/pages/Members";
import { FullScreenLoader } from "../shared/FullScreenLoader";
import { Toaster } from "../shared/notify";
import { parseSearch, stringifySearch } from "./search-params";

const rootRoute = createRootRouteWithContext<{ registry: AtomRegistry.AtomRegistry }>()({
  component: Outlet,
  notFoundComponent: () => <ErrorPage />,
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  component: function Account() {
    return (
      <CurrentCompanyProvider>
        <Outlet />
        <Toaster />
      </CurrentCompanyProvider>
    );
  },
});

const membersRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: "/members",
  validateSearch: redirectTargetSearchSchema,
  component: Members,
});

const routeTree = rootRoute.addChildren([accountRoute.addChildren([membersRoute])]);

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
