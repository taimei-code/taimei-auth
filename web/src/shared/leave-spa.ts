export const SIGN_IN_LANDING_PATH = "/auth?service_name=accounts";

export const ACCOUNT_HOME_PATH = "/account";

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
  accountsServiceUrlFrom(origin, "/auth", ACCOUNT_HOME_PATH);

export const signInUrlAfterSignOut = () => accountSignInUrlFrom(window.location.origin);

export const leaveSpaAfterAccountDeleted = () => leaveSpaTo(signInUrlAfterSignOut());

const signInUrlReturningTo = (returnToHref: string) => accountsServiceUrl("/auth/", returnToHref);

export const companySignupUrlReturningTo = (returnToHref: string) =>
  accountsServiceUrl("/auth/signup/company", returnToHref);

const currentHref = () => {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
};

export const leaveSpaToSignIn = () => leaveSpaTo(signInUrlReturningTo(currentHref()));

export const leaveSpaToCompanySignup = () => leaveSpaTo(companySignupUrlReturningTo(currentHref()));
