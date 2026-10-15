import { expect, test } from "bun:test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

test("TanStack Router は遷移先を history に積んでから beforeLoad と loader を走らせるので、401 の時に今の URL を戻り先にすると遷移先へ戻る", async () => {
  const history = createMemoryHistory({ initialEntries: ["/"] });
  const seen: string[] = [];
  const rootRoute = createRootRoute();
  const membersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/account/members",
    beforeLoad: () => {
      seen.push(`beforeLoad:${history.location.pathname}`);
    },
    loader: () => {
      seen.push(`loader:${history.location.pathname}`);
    },
  });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, membersRoute]),
    history,
    isServer: false,
    origin: "http://auth.taimei-code.local:3100",
  });
  await router.load();

  await router.navigate({ to: "/account/members" });

  expect(seen).toEqual(["beforeLoad:/account/members", "loader:/account/members"]);
});
