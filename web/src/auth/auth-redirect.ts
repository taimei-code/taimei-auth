import { RequestJsonError } from "../shared/request-json";

// SessionGuard は初回 mount でしか session を再評価しないため、navigate ではなく full reload で session を切り替える
export type AuthChange = "signOut" | "deleteAccount";

// cookieCache (最大 5 分) は session の失効に追随しないため、entry redirect を経由すると削除済みの user が事業所作成へ送られる
export const signInLandingUrl = () =>
  `/auth?service_name=accounts&redirect_url=${encodeURIComponent(`${window.location.origin}/account`)}`;

export const redirectAfterAuthChange = (change: AuthChange) => {
  window.location.href = change === "signOut" ? "/" : signInLandingUrl();
};

// SDK の buildAuthLoginUrl は consumer app 向けで契約が違うため使わない
const redirectToAuthFlow = (path: string) => {
  const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  window.location.replace(
    `${path}?service_name=accounts&redirect_url=${encodeURIComponent(returnTo)}`,
  );
};

export const redirectToSignIn = () => redirectToAuthFlow("/auth/");

export const redirectToCompanySignup = () => redirectToAuthFlow("/auth/signup/company");

// getSession は通るのに account API が 401 を返すのは、TTL store の session と DB の user 行が食い違う stale session である。
export const isStaleSessionError = (error: unknown): boolean =>
  error instanceof RequestJsonError && error.status === 401;

// redirectToSignIn を使うと auth-entry-redirect が同じ session のまま事業所登録へ送り返し、ループする
export const discardStaleSession = (signOut: () => Promise<unknown>): Promise<void> =>
  signOut()
    .catch((e) => console.error("signOut failed:", e))
    .then(() => window.location.replace(signInLandingUrl()));
