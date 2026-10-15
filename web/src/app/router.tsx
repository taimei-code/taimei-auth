import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";
import type { ReactNode } from "react";

import {
  ACCEPT_INVITATION_ROUTE,
  acceptInvitationSearchSchema,
  redirectTargetSearchSchema,
} from "@core/invitation/accept-path";
import { signInParamsSchema } from "@core/sign-in-params";

import { companyStateAtom } from "../account/account-atom";
import { accountEntryOf } from "../account/account-entry";
import { CurrentCompanyProvider } from "../account/current-company";
import { Connections } from "../account/pages/Connections";
import { Profile } from "../account/pages/Profile";
import { Security } from "../account/pages/Security";
import { Sessions } from "../account/pages/Sessions";
import { AuthLayout } from "../auth/AuthLayout";
import { authErrorSearchSchema } from "../auth/auth-error-reason";
import { ErrorPage } from "../auth/pages/Error";
import { SignIn } from "../auth/pages/SignIn";
import { SignUp } from "../auth/pages/SignUp";
import { readCompanySignupEntry } from "../company/company-signup-entry";
import { Companies } from "../company/pages/Companies";
import { CompanySettings } from "../company/pages/CompanySettings";
import { SignUpCompany } from "../company/pages/SignUpCompany";
import { acceptInvitation } from "../invitation/accept-invitation";
import { SignUpAcceptInvitation } from "../invitation/pages/SignUpAcceptInvitation";
import { Members } from "../membership/pages/Members";
import { mfaChallengeObservationOf, mfaChallengeStateAtom } from "../mfa/mfa-atom";
import { MfaChallengeLoading } from "../mfa/MfaChallengeView";
import { MfaChallenge } from "../mfa/pages/MfaChallenge";
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
  component: AuthLayout,
});

const toInvalidRedirectError = () => {
  throw redirect({ to: "/auth/error", search: { reason: "invalid_redirect_url" }, replace: true });
};

const signInRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/",
  validateSearch: signInParamsSchema,
  onError: toInvalidRedirectError,
  component: SignIn,
});

const signUpRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/signup",
  validateSearch: signInParamsSchema,
  onError: toInvalidRedirectError,
  component: SignUp,
});

const companySignupRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/signup/company",
  validateSearch: signInParamsSchema.catch({
    service_name: "accounts",
    redirect_url: "/account",
  }),
  beforeLoad: async ({ context, location, search, abortController }) => {
    const entry = await readCompanySignupEntry(
      context.registry,
      abortController.signal,
      search.redirect_url,
    );
    if (entry.kind !== "show") throw redirectFor(entry, location.href);
  },
  component: SignUpCompany,
});

const acceptInvitationRoute = createRoute({
  getParentRoute: () => authRoute,
  path: ACCEPT_INVITATION_ROUTE,
  validateSearch: acceptInvitationSearchSchema,
  loaderDeps: ({ search }) => acceptInvitationSearchSchema.parse(search),
  loader: async ({ context, deps, location }) => {
    const entry = await acceptInvitation(context.registry, deps);
    if (entry.kind !== "failed") throw redirectFor(entry, location.href);
    return { message: entry.message };
  },
  component: SignUpAcceptInvitation,
});

const mfaChallengeRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/mfa",
  loader: async ({ context, abortController }) =>
    mfaChallengeObservationOf(
      await readResult(context.registry, mfaChallengeStateAtom, abortController.signal),
    ),
  pendingComponent: MfaChallengeLoading,
  component: MfaChallenge,
});

const errorRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/error",
  validateSearch: authErrorSearchSchema,
  component: function AuthError() {
    return <ErrorPage reason={errorRoute.useSearch().reason} />;
  },
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  beforeLoad: async ({ context, location, abortController }) => {
    const entry = accountEntryOf(
      await readResult(context.registry, companyStateAtom, abortController.signal),
    );
    if (entry.kind !== "show") throw redirectFor(entry, location.href);
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
  authRoute.addChildren([
    signInRoute,
    signUpRoute,
    companySignupRoute,
    acceptInvitationRoute,
    mfaChallengeRoute,
    errorRoute,
  ]),
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
