import { useAtomSet } from "@effect/atom-react";

import type { Role } from "@core/membership/policy";
import type { RedirectTarget } from "@core/sign-in-params";

import { SpaApiClient } from "../shared/spa-api-client";

const invitationsKey = (companyId: string) => `invitations:${companyId}`;

export const pendingInvitationsOf = (companyId: string) =>
  SpaApiClient.query("invitation", "pending", {
    params: { companyId },
    reactivityKeys: [invitationsKey(companyId)],
  });

const createInvitationAtom = SpaApiClient.mutation("invitation", "create");
const revokeInvitationAtom = SpaApiClient.mutation("invitation", "revoke");
export const acceptInvitationAtom = SpaApiClient.mutation("invitation", "accept");

type NewInvitation = { email: string; role: Role; redirect_target?: RedirectTarget };

export const useCreateInvitation = () => {
  const createInvitation = useAtomSet(createInvitationAtom, { mode: "promiseExit" });
  return (companyId: string, payload: NewInvitation) =>
    createInvitation({
      params: { companyId },
      payload,
      reactivityKeys: [invitationsKey(companyId)],
    });
};

export const useRevokeInvitation = () => {
  const revokeInvitation = useAtomSet(revokeInvitationAtom, { mode: "promiseExit" });
  return (companyId: string, invitationId: string) =>
    revokeInvitation({
      params: { companyId, invitationId },
      reactivityKeys: [invitationsKey(companyId)],
    });
};
