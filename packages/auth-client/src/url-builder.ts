export interface BuildAuthLoginUrlOptions {
  authBaseUrl: string;
  service: string;
  returnTo: string;
  signUpUrl?: string;
  hash?: string;
}

type ReturnToServiceOptions = Pick<
  BuildAuthLoginUrlOptions,
  "authBaseUrl" | "service" | "returnTo"
>;

const authHostUrl = (authBaseUrl: string, path: string): URL =>
  new URL(`${authBaseUrl.replace(/\/$/, "")}${path}`);

const authHostUrlReturningToService = (opts: ReturnToServiceOptions, path: string): URL => {
  const url = authHostUrl(opts.authBaseUrl, path);
  url.searchParams.set("service_name", opts.service);
  url.searchParams.set("redirect_url", opts.returnTo);
  return url;
};

export const buildAuthLoginUrl = (opts: BuildAuthLoginUrlOptions): string => {
  const url = authHostUrlReturningToService(opts, "/auth/");
  if (opts.signUpUrl !== undefined) {
    url.searchParams.set("sign_up_url", opts.signUpUrl);
  }
  if (opts.hash !== undefined) {
    url.hash = opts.hash;
  }
  return url.toString();
};

export const AUTH_ERROR_REASONS = ["signin_failed", "signup_already_completed"] as const;

export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[number];

export const buildAuthErrorUrl = (opts: {
  authBaseUrl: string;
  reason: AuthErrorReason;
}): string => {
  const url = authHostUrl(opts.authBaseUrl, "/auth/error");
  url.searchParams.set("reason", opts.reason);
  return url.toString();
};

export const buildCompanySignupUrl = (opts: ReturnToServiceOptions): string =>
  authHostUrlReturningToService(opts, "/auth/signup/company").toString();

export const buildMembersUrl = (opts: ReturnToServiceOptions): string =>
  authHostUrlReturningToService(opts, "/account/members").toString();

export const buildDevHomeUrl = (opts: ReturnToServiceOptions): string =>
  authHostUrlReturningToService(opts, "/dev").toString();

export const buildAccountUrl = (opts: { authBaseUrl: string }): string =>
  authHostUrl(opts.authBaseUrl, "/account").toString();
