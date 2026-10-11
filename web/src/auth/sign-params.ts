import { type SignInParams, signInParamsSchema } from "@core/sign-in-params";
import { acceptInvitationPath } from "@core/invitation/accept-path";

// redirect_url へ直接送ると membership が作られないまま signup/company へ進み、招待受諾の流れから外れる
export const invitationAcceptCallbackUrl = (invitationToken: string): string =>
  `${window.location.origin}${acceptInvitationPath(invitationToken)}`;

// router の search は、宣言していない key (error=signin_failed など) も実行時に保つ
export const declaredSignInParams = (search: SignInParams): SignInParams =>
  signInParamsSchema.parse(search);
