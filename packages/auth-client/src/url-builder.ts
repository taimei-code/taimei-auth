// 共通ログイン URL の組み立てを SDK に集約する (consumer 側でのキー名 typo / 順序の揺らぎを防ぐ)
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

/** @deprecated v2.0.0 で削除する。sign-out は `authClient.signOut()` で行う (理由は CHANGELOG)。 */
export interface BuildAuthLogoutUrlOptions {
  authBaseUrl: string;
  service: string;
  redirectTo?: string;
}

/** @deprecated v2.0.0 で削除する。sign-out は `authClient.signOut()` で行う (理由は CHANGELOG)。 */
export const buildAuthLogoutUrl = (opts: BuildAuthLogoutUrlOptions): string => {
  const url = new URL(`${opts.authBaseUrl.replace(/\/$/, "")}/auth/sign-out`);
  url.searchParams.set("service_name", opts.service);
  if (opts.redirectTo !== undefined) {
    url.searchParams.set("redirect_url", opts.redirectTo);
  }
  return url.toString();
};
