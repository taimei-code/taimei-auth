export const SIGN_IN_LANDING_PATH = "/auth?service_name=accounts";

const documentsBeingLeft = new WeakSet<Location>();

export const leaveSpaTo = (url: string) => {
  if (documentsBeingLeft.has(window.location)) {
    return;
  }
  documentsBeingLeft.add(window.location);
  window.location.replace(url);
};

export const loadDocument = (href: string) => window.location.assign(href);

type AccountsServicePath = "/auth/" | "/auth" | "/auth/signup/company";

const accountsServiceUrlFrom = (origin: string, path: AccountsServicePath, returnToHref: string) =>
  `${path}?service_name=accounts&redirect_url=${encodeURIComponent(`${origin}${returnToHref}`)}`;

const accountsServiceUrl = (path: AccountsServicePath, returnToHref: string) =>
  accountsServiceUrlFrom(window.location.origin, path, returnToHref);

export const accountSignInUrlFrom = (origin: string) =>
  accountsServiceUrlFrom(origin, "/auth", "/account");

export const signInUrlAfterSignOut = () => accountSignInUrlFrom(window.location.origin);

export const leaveSpaAfterAccountDeleted = () => leaveSpaTo(signInUrlAfterSignOut());

export const signInUrlReturningTo = (returnToHref: string) =>
  accountsServiceUrl("/auth/", returnToHref);

export const companySignupUrlReturningTo = (returnToHref: string) =>
  accountsServiceUrl("/auth/signup/company", returnToHref);

export const leaveSpaToSignIn = () => {
  const { pathname, search, hash } = window.location;
  leaveSpaTo(signInUrlReturningTo(`${pathname}${search}${hash}`));
};
