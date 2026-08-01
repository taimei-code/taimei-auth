// SessionGuard は初回 mount のみで session を再評価するため、navigate ではなく full reload で副作用を断つ
export const AUTH_REDIRECT_TARGETS = {
  signOut: "/",
  deleteAccount: "/auth",
} as const;

export type AuthRedirectTarget = keyof typeof AUTH_REDIRECT_TARGETS;

export const redirectAfterAuthChange = (target: AuthRedirectTarget) => {
  window.location.href = AUTH_REDIRECT_TARGETS[target];
};

// 未認証 (または前提を満たさない) 画面から共通ログイン系画面へ移す。現在地を redirect_url に
// 載せてログイン完了後に元の場所へ戻す。query キー名 / service_name の組立てを画面ごとに
// 手書きすると変更時に一部画面だけ戻れなくなるため 1 箇所に置く。
export const redirectToSignIn = (path = "/auth/") => {
  const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  window.location.replace(
    `${path}?service_name=accounts&redirect_url=${encodeURIComponent(returnTo)}`,
  );
};
