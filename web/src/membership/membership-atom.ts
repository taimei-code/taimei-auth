import { useAtomSet } from "@effect/atom-react";

import type { Role } from "@core/membership/policy";

import { SpaApiClient } from "../shared/spa-api-client";

const membersKey = (companyId: string) => `members:${companyId}`;

export const membersOf = (companyId: string) =>
  SpaApiClient.query("membership", "list", {
    params: { companyId },
    reactivityKeys: [membersKey(companyId)],
  });

const changeRoleAtom = SpaApiClient.mutation("membership", "changeRole");
const removeMemberAtom = SpaApiClient.mutation("membership", "remove");
export const transferOwnershipAtom = SpaApiClient.mutation("membership", "transferOwnership");

export const useChangeRole = () => {
  const changeRole = useAtomSet(changeRoleAtom, { mode: "promiseExit" });
  return (companyId: string, targetUserId: string, role: Role) =>
    changeRole({
      params: { companyId, targetUserId },
      payload: { role },
      reactivityKeys: [membersKey(companyId)],
    });
};

export const useRemoveMember = () => {
  const removeMember = useAtomSet(removeMemberAtom, { mode: "promiseExit" });
  return (companyId: string, targetUserId: string) =>
    removeMember({
      params: { companyId, targetUserId },
      reactivityKeys: [membersKey(companyId)],
    });
};
