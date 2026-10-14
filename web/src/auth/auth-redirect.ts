export type AuthChange = "signOut" | "deleteAccount";

const signInLandingUrl = () =>
  `/auth?service_name=accounts&redirect_url=${encodeURIComponent(signInLandingSearch().redirect_url)}`;

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

export const discardStaleSession = (signOut: () => Promise<unknown>): Promise<void> =>
  signOutLoggingFailure(signOut).then(() => window.location.replace(signInLandingUrl()));
