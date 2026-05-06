// signInParamsSchema (src/sign-in-params.ts) のキー集合と同期させる。
// allowlist 方式: stale state (例: error=signin_failed) を相互リンクで持ち込まないため。
const ALLOWLIST = ["service_name", "redirect_url", "sign_up_url"] as const;

export const buildSignParams = (searchParams: URLSearchParams): string => {
  const out = new URLSearchParams();
  for (const key of ALLOWLIST) {
    const value = searchParams.get(key);
    if (value !== null) out.set(key, value);
  }
  return out.toString();
};
