import { acceptInvitationPath } from "@core/invitation/accept-path";
import { signInParamsObjectSchema } from "@core/sign-in-params";

// signInParamsSchema のキーのみ通す (error=signin_failed 等の stale state を相互リンクで持ち込ませない)。
// キー集合は schema の shape から導出し、schema にキーを足した時にここだけ取り残されて
// その param が相互リンク経由で silent に消えるのを防ぐ。
const ALLOWLIST = Object.keys(signInParamsObjectSchema.shape);

export const buildSignParams = (searchParams: URLSearchParams): string => {
  const out = new URLSearchParams();
  for (const key of ALLOWLIST) {
    const value = searchParams.get(key);
    if (value !== null) out.set(key, value);
  }
  return out.toString();
};

// 招待経由は Magic Link click 後に accept-invitation へ着地させ membership を作る。
// redirect_url へ直行すると membership が作られないまま signup/company へ流れ、招待受諾フローから
// 脱落する。SignIn / SignUp どちらのフォームから送信しても着地先はここに揃える。
export const invitationAcceptCallbackUrl = (invitationToken: string): string =>
  `${window.location.origin}${acceptInvitationPath(invitationToken)}`;
