import { z } from "zod";

import { type RedirectTarget, redirectTargetSchema } from "@core/sign-in-params";

const optionalString = z.string().optional().catch(undefined);

export const redirectTargetSearchSchema = z.object({
  service_name: optionalString,
  redirect_url: optionalString,
});

export const acceptInvitationSearchSchema = redirectTargetSearchSchema.extend({
  invitation_token: optionalString,
});

export type RedirectTargetSearch = z.output<typeof redirectTargetSearchSchema>;

export type AcceptInvitationSearch = z.output<typeof acceptInvitationSearchSchema>;

export const parseRedirectTarget = (search: RedirectTargetSearch): RedirectTarget | undefined =>
  redirectTargetSchema.safeParse(search).data;

export const redirectUrlAfterAccept = (search: RedirectTargetSearch): string =>
  parseRedirectTarget(search)?.redirect_url ?? "/account";
