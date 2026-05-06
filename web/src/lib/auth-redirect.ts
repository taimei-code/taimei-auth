// 認証ライフサイクル直後のリダイレクト用 helper。
// react-router の navigate ではなく window.location を使う理由: SessionGuard が認証状態を
// 再評価するタイミングは初回 mount のみで、navigate 経由だと再 mount されず stale な session
// 状態のまま /account を出してしまう可能性がある。完全な再 boot で副作用を断ち切る。
export const AUTH_REDIRECT_TARGETS = {
  signOut: "/",
  deleteAccount: "/auth",
} as const;

export type AuthRedirectTarget = keyof typeof AUTH_REDIRECT_TARGETS;

export const redirectAfterAuthChange = (target: AuthRedirectTarget) => {
  window.location.href = AUTH_REDIRECT_TARGETS[target];
};
