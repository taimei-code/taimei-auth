export const SIGN_IN_LANDING_PATH = "/auth?service_name=accounts";

export const searchReturningTo = (href: string) => ({
  service_name: "accounts" as const,
  redirect_url: `${window.location.origin}${href}`,
});

export const signInLandingSearch = () => searchReturningTo("/account");

const documentsBeingLeft = new WeakSet<Location>();

export const leaveSpaTo = (url: string) => {
  if (documentsBeingLeft.has(window.location)) return;
  documentsBeingLeft.add(window.location);
  window.location.replace(url);
};

type SignInPath = "/auth/" | "/auth";

const signInUrl = (path: SignInPath, returnToHref: string) => {
  const { service_name, redirect_url } = searchReturningTo(returnToHref);
  return `${path}?service_name=${service_name}&redirect_url=${encodeURIComponent(redirect_url)}`;
};

export const signInUrlAfterSignOut = () => signInUrl("/auth", "/account");

export const leaveSpaAfterAccountDeleted = () => leaveSpaTo(signInUrlAfterSignOut());

export const leaveSpaToSignIn = () => {
  const { pathname, search, hash } = window.location;
  leaveSpaTo(signInUrl("/auth/", `${pathname}${search}${hash}`));
};
