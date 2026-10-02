export interface BuildAuthLoginUrlOptions {
  authBaseUrl: string;
  service: string;
  returnTo: string;
  signUpUrl?: string;
  hash?: string;
}

export const buildAuthLoginUrl = (opts: BuildAuthLoginUrlOptions): string => {
  const url = new URL(`${opts.authBaseUrl.replace(/\/$/, "")}/auth/`);
  url.searchParams.set("service_name", opts.service);
  url.searchParams.set("redirect_url", opts.returnTo);
  if (opts.signUpUrl !== undefined) {
    url.searchParams.set("sign_up_url", opts.signUpUrl);
  }
  if (opts.hash !== undefined) {
    url.hash = opts.hash;
  }
  return url.toString();
};
