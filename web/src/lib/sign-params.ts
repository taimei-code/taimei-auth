// signInParamsSchema のキーのみ通す (error=signin_failed 等の stale state を相互リンクで持ち込ませない)
const ALLOWLIST = ["service_name", "redirect_url", "sign_up_url"] as const;

export const buildSignParams = (searchParams: URLSearchParams): string => {
  const out = new URLSearchParams();
  for (const key of ALLOWLIST) {
    const value = searchParams.get(key);
    if (value !== null) out.set(key, value);
  }
  return out.toString();
};
