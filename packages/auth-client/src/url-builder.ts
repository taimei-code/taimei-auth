// taimei-auth (sign 流) の共通ログイン URL を組み立てる helper。
// 各プロダクトの proxy / middleware からこれらを呼び、SignInParams (PR1 の Zod schema) と
// 整合する形のクエリ文字列を生成する。helper 側で URL 組み立てを集約することで、
// クエリ名の typo (例: redirect_url vs redirectUrl) や順序の揺らぎを排除する。

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

export const buildAuthLogoutUrl = (
  opts: BuildAuthLogoutUrlOptions,
): string => {
  const url = new URL(
    `${opts.authBaseUrl.replace(/\/$/, "")}/auth/sign-out`,
  );
  url.searchParams.set("service_name", opts.service);
  if (opts.redirectTo !== undefined) {
    url.searchParams.set("redirect_url", opts.redirectTo);
  }
  return url.toString();
};
