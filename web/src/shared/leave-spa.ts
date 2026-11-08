export const SIGN_IN_LANDING_PATH = "/auth?service_name=accounts";

export const searchReturningTo = (href: string) => ({
  service_name: "accounts" as const,
  redirect_url: `${window.location.origin}${href}`,
});

const documentsBeingLeft = new WeakSet<Location>();

export const leaveSpaTo = (url: string) => {
  if (documentsBeingLeft.has(window.location)) {
    return;
  }
  documentsBeingLeft.add(window.location);
  window.location.replace(url);
};

export const loadDocument = (href: string) => window.location.assign(href);

type SignInPath = "/auth/" | "/auth";

const signInUrlFrom = (origin: string, path: SignInPath, returnToHref: string) =>
  `${path}?service_name=accounts&redirect_url=${encodeURIComponent(`${origin}${returnToHref}`)}`;

const signInUrl = (path: SignInPath, returnToHref: string) =>
  signInUrlFrom(window.location.origin, path, returnToHref);

export const accountSignInUrlFrom = (origin: string) => signInUrlFrom(origin, "/auth", "/account");

export const signInUrlAfterSignOut = () => accountSignInUrlFrom(window.location.origin);

export const leaveSpaAfterAccountDeleted = () => leaveSpaTo(signInUrlAfterSignOut());

export const signInUrlReturningTo = (returnToHref: string) => signInUrl("/auth/", returnToHref);

export const leaveSpaToSignIn = () => {
  const { pathname, search, hash } = window.location;
  leaveSpaTo(signInUrlReturningTo(`${pathname}${search}${hash}`));
};
