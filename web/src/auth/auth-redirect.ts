import { RequestJsonError } from "../shared/request-json";

// SessionGuard は初回 mount のみで session を再評価するため、navigate ではなく full reload で副作用を断つ。
// deleteAccount は退会・最終事業所削除・最終所属離脱によるアカウント連動削除を指す。
export type AuthChange = "signOut" | "deleteAccount";

// アカウント削除直後の着地先。cookieCache (最大 5 分) は server 側の session 失効に追随せず、entry redirect
// (AUTH_ENTRY_PATHS) を通すと削除済み user が事業所作成画面へ流れるため、非対象の /auth へ必須 params 付きで直行する。
export const signInLandingUrl = () =>
  `/auth?service_name=accounts&redirect_url=${encodeURIComponent(`${window.location.origin}/account`)}`;

export const redirectAfterAuthChange = (change: AuthChange) => {
  window.location.href = change === "signOut" ? "/" : signInLandingUrl();
};

// 現在地を redirect_url に載せて auth 系画面へ full reload 遷移する共通機構 (画面ごとの手書きだと一部だけ
// 戻れなくなる)。SDK の buildAuthLoginUrl は consumer app 向けで契約が違う。キー名の正本: src/sign-in-params.ts。
const redirectToAuthFlow = (path: string) => {
  const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  window.location.replace(
    `${path}?service_name=accounts&redirect_url=${encodeURIComponent(returnTo)}`,
  );
};

export const redirectToSignIn = () => redirectToAuthFlow("/auth/");

// 事業所未確定 (membership 0 件) の user を /account 操作の前に事業所作成へ誘導する。
export const redirectToCompanySignup = () => redirectToAuthFlow("/auth/signup/company");

// getSession は通るのに account API が 401 = Redis の session と DB の user 行が食い違う stale session。
export const isStaleSessionError = (error: unknown): boolean =>
  error instanceof RequestJsonError && error.status === 401;

// redirectToSignIn だと auth-entry-redirect が同じ session で事業所登録へ送り返しループするため、
// session を破棄してから entry redirect 非対象の sign-in landing へ送る。
export const discardStaleSession = (signOut: () => Promise<unknown>): Promise<void> =>
  signOut()
    .catch((e) => console.error("signOut failed:", e))
    .then(() => window.location.replace(signInLandingUrl()));
