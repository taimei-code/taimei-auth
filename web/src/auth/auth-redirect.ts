// SessionGuard は初回 mount のみで session を再評価するため、navigate ではなく full reload で副作用を断つ
// 呼び出し側は「何が起きたか」だけを渡し、着地先の解決はこのモジュールに閉じる
// (deleteAccount = 退会・最終事業所削除・最終所属離脱のアカウント連動削除を含む)。
export type AuthChange = "signOut" | "deleteAccount";

// アカウント削除 (退会・最後の事業所削除) 直後にログイン画面へ着地させる URL。
// better-auth cookieCache (最大 5 分) は server 側の session 失効に追随しないため、entry redirect
// (src/handlers/auth-entry-redirect.ts の AUTH_ENTRY_PATHS) を通すと削除済み user が
// 「session あり・membership 0 件」と判定され事業所作成画面へ誘導される。末尾スラッシュ無し /auth は
// AUTH_ENTRY_PATHS 非対象で SPA まで素通しされるので、SignIn の必須 params (signInParamsSchema) を
// 付けて直接ログイン画面に着地する。素の /auth は params 欠落で invalid_redirect_url エラー画面に落ちる。
export const signInLandingUrl = () =>
  `/auth?service_name=accounts&redirect_url=${encodeURIComponent(`${window.location.origin}/account`)}`;

export const redirectAfterAuthChange = (change: AuthChange) => {
  window.location.href = change === "signOut" ? "/" : signInLandingUrl();
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

// 事業所未確定 (membership 0 件) の user を /account 操作の前に事業所作成へ誘導する。
export const redirectToCompanySignup = () => redirectToAuthFlow("/auth/signup/company");
