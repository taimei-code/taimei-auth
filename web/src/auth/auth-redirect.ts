export type AuthChange = "signOut" | "deleteAccount";

// 末尾スラッシュ無しの /auth は auth-entry-redirect の対象外。cookieCache (最大 5 分) の stale session が事業所作成へ送られるのを避ける
const signInLandingUrl = () =>
  `/auth?service_name=accounts&redirect_url=${encodeURIComponent(signInLandingSearch().redirect_url)}`;

// 認証の状態が変わった後は registry の事業所状態を捨てるため full reload
export const redirectAfterAuthChange = (change: AuthChange) => {
  window.location.href = change === "signOut" ? "/" : signInLandingUrl();
};

export const searchReturningTo = (href: string) => ({
  service_name: "accounts" as const,
  redirect_url: `${window.location.origin}${href}`,
});

export const signInLandingSearch = () => searchReturningTo("/account");

export const signOutLoggingFailure = (signOut: () => Promise<unknown>): Promise<void> =>
  signOut().then(
    () => undefined,
    (e) => console.error("signOut failed:", e),
  );

// 先に signOut しないと auth-entry-redirect が同じ session のまま事業所登録へ送り返してループする
export const discardStaleSession = (signOut: () => Promise<unknown>): Promise<void> =>
  signOutLoggingFailure(signOut).then(() => window.location.replace(signInLandingUrl()));
