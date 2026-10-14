import { type SignInParams, signInParamsSchema } from "@core/sign-in-params";
import { acceptInvitationPath } from "@core/invitation/accept-path";

export const invitationAcceptCallbackUrl = (invitationToken: string): string =>
  `${window.location.origin}${acceptInvitationPath(invitationToken)}`;

export const declaredSignInParams = (search: SignInParams): SignInParams =>
  signInParamsSchema.parse(search);
