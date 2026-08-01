// signInParamsSchema のキーのみ通す (error=signin_failed 等の stale state を相互リンクで持ち込ませない)
const ALLOWLIST = ["service_name", "redirect_url", "sign_up_url", "invitation_token"] as const;

export const buildSignParams = (searchParams: URLSearchParams): string => {
  const out = new URLSearchParams();
  for (const key of ALLOWLIST) {
    const value = searchParams.get(key);
    if (value !== null) out.set(key, value);
  }
  return out.toString();
};

// ADR-009: 招待経由は Magic Link click 後に accept-invitation へ着地させ membership を作る。
// redirect_url へ直行すると membership が作られないまま signup/company へ流れ、招待受諾フローから
// 脱落する。SignIn / SignUp どちらのフォームから送信しても着地先はここに揃える。
export const invitationAcceptCallbackUrl = (invitationToken: string): string =>
  `${window.location.origin}/auth/signup/accept-invitation?invitation_token=${encodeURIComponent(invitationToken)}`;
