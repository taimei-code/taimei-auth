import { RequestJsonError } from "../shared/request-json";

export type AuthChange = "signOut" | "deleteAccount";

// 末尾スラッシュ無しの /auth は auth-entry-redirect の対象外。cookieCache (最大 5 分) の stale session が事業所作成へ送られるのを避ける
export const signInLandingUrl = () =>
  `/auth?service_name=accounts&redirect_url=${encodeURIComponent(`${window.location.origin}/account`)}`;

// SessionGuard は初回 mount でしか session を再評価しないため navigate でなく full reload
export const redirectAfterAuthChange = (change: AuthChange) => {
  window.location.href = change === "signOut" ? "/" : signInLandingUrl();
};

const redirectToAuthFlow = (path: string) => {
  const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  window.location.replace(
    `${path}?service_name=accounts&redirect_url=${encodeURIComponent(returnTo)}`,
  );
};

export const redirectToSignIn = () => redirectToAuthFlow("/auth/");

export const redirectToCompanySignup = () => redirectToAuthFlow("/auth/signup/company");

// TTL store に session が残り DB の user 行が無い stale session は、getSession が通り account API だけ 401 になる
export const isStaleSessionError = (error: unknown): boolean =>
  error instanceof RequestJsonError && error.status === 401;

// 先に signOut しないと auth-entry-redirect が同じ session のまま事業所登録へ送り返してループする
export const discardStaleSession = (signOut: () => Promise<unknown>): Promise<void> =>
  signOut()
    .catch((e) => console.error("signOut failed:", e))
    .then(() => window.location.replace(signInLandingUrl()));
