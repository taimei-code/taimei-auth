import { z } from "zod";
import type { RedirectTarget } from "../sign-in-params";

const optionalString = z.string().optional().catch(undefined);

export const redirectTargetSearchSchema = z.object({
  service_name: optionalString,
  redirect_url: optionalString,
});

export const acceptInvitationSearchSchema = redirectTargetSearchSchema.extend({
  invitation_token: optionalString,
});

export const ACCEPT_INVITATION_ROUTE = "/signup/accept-invitation";
export const ACCEPT_INVITATION_PATH = `/auth${ACCEPT_INVITATION_ROUTE}` as const;

export const acceptInvitationPath = (invitationToken: string, target?: RedirectTarget): string => {
  const search = {
    invitation_token: invitationToken,
    ...target,
  } satisfies z.input<typeof acceptInvitationSearchSchema>;
  return `${ACCEPT_INVITATION_PATH}?${new URLSearchParams(search)}`;
};
