// SessionGuard は初回 mount のみで session を再評価するため、navigate ではなく full reload で副作用を断つ
export const AUTH_REDIRECT_TARGETS = {
  signOut: "/",
  deleteAccount: "/auth",
} as const;

export type AuthRedirectTarget = keyof typeof AUTH_REDIRECT_TARGETS;

export const redirectAfterAuthChange = (target: AuthRedirectTarget) => {
  window.location.href = AUTH_REDIRECT_TARGETS[target];
};
