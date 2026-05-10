// 共通ログイン URL を SDK 側で組み立てる (sign 流)。consumer 側で `redirect_url` 等のキー名 typo や
// 順序の揺らぎが発生しないよう、URL 組み立てをこの helper に集約する
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

export interface BuildAuthLogoutUrlOptions {
  authBaseUrl: string;
  service: string;
  redirectTo?: string;
}

export const buildAuthLogoutUrl = (opts: BuildAuthLogoutUrlOptions): string => {
  const url = new URL(`${opts.authBaseUrl.replace(/\/$/, "")}/auth/sign-out`);
  url.searchParams.set("service_name", opts.service);
  if (opts.redirectTo !== undefined) {
    url.searchParams.set("redirect_url", opts.redirectTo);
  }
  return url.toString();
};
