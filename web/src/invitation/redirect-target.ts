import type { z } from "zod";

import {
  type acceptInvitationSearchSchema,
  type redirectTargetSearchSchema,
} from "@core/invitation/accept-path";
import { type RedirectTarget, redirectTargetSchema } from "@core/sign-in-params";

export type RedirectTargetSearch = z.output<typeof redirectTargetSearchSchema>;

export type AcceptInvitationSearch = z.output<typeof acceptInvitationSearchSchema>;

export const parseRedirectTarget = (search: RedirectTargetSearch): RedirectTarget | undefined =>
  redirectTargetSchema.safeParse(search).data;

export const redirectUrlAfterAccept = (search: RedirectTargetSearch): string =>
  parseRedirectTarget(search)?.redirect_url ?? "/account";
