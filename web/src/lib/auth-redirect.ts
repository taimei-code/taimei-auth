// SessionGuard は初回 mount のみで session を再評価するため、navigate ではなく full reload で副作用を断つ
export const AUTH_REDIRECT_TARGETS = {
  signOut: "/",
  deleteAccount: "/auth",
} as const;

export type AuthRedirectTarget = keyof typeof AUTH_REDIRECT_TARGETS;

export const redirectAfterAuthChange = (target: AuthRedirectTarget) => {
  window.location.href = AUTH_REDIRECT_TARGETS[target];
};

// 現在地を redirect_url に載せて auth 系画面へ full reload 遷移する共通機構。SPA 内の
// 画面ごとに query 組立てが手書きされると変更時に一部画面だけ戻れなくなるため、ここに置く。
// SDK の buildAuthLoginUrl は consumer app 向け (/auth/ 固定・authBaseUrl 明示) の builder で、
// 任意の auth 系 path へ現在地付きで飛ぶ web 内部の用途とは契約が異なる。query キー名の正本は
// signInParamsSchema (src/sign-in-params.ts)。
const redirectToAuthFlow = (path: string) => {
  const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  window.location.replace(
    `${path}?service_name=accounts&redirect_url=${encodeURIComponent(returnTo)}`,
  );
};

export const redirectToSignIn = () => redirectToAuthFlow("/auth/");

// ADR-009: 事業所未確定 (membership 0 件) の user を /account 操作の前に事業所作成へ誘導する。
export const redirectToCompanySignup = () => redirectToAuthFlow("/auth/signup/company");
