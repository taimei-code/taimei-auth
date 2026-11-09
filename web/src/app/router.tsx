import { createRootRouteWithContext, createRouter, Outlet } from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";

import { ErrorPage } from "../auth/pages/Error";
import { FullScreenLoader } from "../shared/FullScreenLoader";
import { parseSearch, stringifySearch } from "./search-params";

const rootRoute = createRootRouteWithContext<{ registry: AtomRegistry.AtomRegistry }>()({
  component: Outlet,
  notFoundComponent: () => <ErrorPage />,
});

export const makeRouter = (registry: AtomRegistry.AtomRegistry) =>
  createRouter({
    routeTree: rootRoute,
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
