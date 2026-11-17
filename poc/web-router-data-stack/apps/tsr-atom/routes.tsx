import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { Effect, Exit } from "effect";
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { signInParamsSchema } from "@core/sign-in-params";
import { acceptInvitation } from "../../shared/api";
import { companyStateAtom } from "./atoms";
import { Members } from "./Members";

const rootRoute = createRootRouteWithContext<{ registry: AtomRegistry.AtomRegistry }>()({
  component: Outlet,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  validateSearch: signInParamsSchema,
  component: function SignIn() {
    const search = signInRoute.useSearch();
    return <p data-testid="signin">sign in for {search.service_name} → {search.redirect_url}</p>;
  },
});

export const ERROR_REASONS = ["invalid_redirect_url", "signup_already_completed", "signin_failed", "default"] as const;

const errorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/error",
  validateSearch: z.object({ reason: z.enum(ERROR_REASONS).optional().catch(undefined) }),
  component: function ErrorPage() {
    const { reason } = errorRoute.useSearch();
    return <p data-testid="error-reason">{reason ?? "default"}</p>;
  },
});

const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/signup/accept-invitation",
  validateSearch: z.object({ invitation_token: z.string().min(1) }),
  loaderDeps: ({ search }) => ({ token: search.invitation_token }),
  loader: async ({ deps }) => {
    const exit = await Effect.runPromiseExit(acceptInvitation(deps.token));
    if (Exit.isSuccess(exit)) throw redirect({ to: "/account/members" });
    return { failed: true as const };
  },
  component: function AcceptInvitation() {
    return <p data-testid="accept-failed">招待の受諾に失敗しました</p>;
  },
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  beforeLoad: async ({ context, location }) => {
    const exit = await Effect.runPromiseExit(AtomRegistry.getResult(companyStateAtom)(context.registry));
    if (Exit.isFailure(exit)) {
      throw redirect({
        to: "/auth",
        search: { service_name: "accounts", redirect_url: `${window.location.origin}${location.href}` },
      });
    }
  },
  component: Outlet,
});

const membersRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: "/members",
  component: Members,
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  errorRoute,
  acceptInvitationRoute,
  accountRoute.addChildren([membersRoute]),
]);

export const makeRouter = (registry: AtomRegistry.AtomRegistry) =>
  createRouter({ routeTree, context: { registry } });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}

export { AsyncResult };
