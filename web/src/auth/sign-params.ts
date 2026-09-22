import { acceptInvitationPath } from "@core/invitation/accept-path";
import { signInParamsObjectSchema } from "@core/sign-in-params";

// 画面間のリンクで error=signin_failed などの古い param を引き継がせないための allowlist
const ALLOWLIST = Object.keys(signInParamsObjectSchema.shape);

export const buildSignParams = (searchParams: URLSearchParams): string => {
  const out = new URLSearchParams();
  for (const key of ALLOWLIST) {
    const value = searchParams.get(key);
    if (value !== null) out.set(key, value);
  }
  return out.toString();
};

// redirect_url へ直接送ると membership が作られないまま signup/company へ進み、招待受諾の流れから外れる
export const invitationAcceptCallbackUrl = (invitationToken: string): string =>
  `${window.location.origin}${acceptInvitationPath(invitationToken)}`;
