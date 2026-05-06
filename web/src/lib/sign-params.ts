// 共通ログイン画面 ↔ 共通サインアップ画面 の相互リンクで引き継ぐクエリ。
// allowlist 方式: stale state (例: error=signin_failed) を遷移先に持ち込まない。
const ALLOWLIST = ["service_name", "redirect_url", "sign_up_url"] as const;

export const buildSignParams = (searchParams: URLSearchParams): string => {
  const out = new URLSearchParams();
  for (const key of ALLOWLIST) {
    const value = searchParams.get(key);
    if (value !== null) out.set(key, value);
  }
  return out.toString();
};
