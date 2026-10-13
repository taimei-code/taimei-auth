import { useAtomSet } from "@effect/atom-react";

import type { Role } from "@core/membership/policy";

import { COMPANY_STATE_KEY } from "../account/account-atom";
import { SpaApiClient } from "../shared/spa-api-client";

const membersKey = (companyId: string) => `members:${companyId}`;

export const membersOf = (companyId: string) =>
  SpaApiClient.query("membership", "list", {
    params: { companyId },
    reactivityKeys: [membersKey(companyId)],
  });

const changeRoleAtom = SpaApiClient.mutation("membership", "changeRole");
const removeMemberAtom = SpaApiClient.mutation("membership", "remove");
const transferOwnershipAtom = SpaApiClient.mutation("membership", "transferOwnership");

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
      reactivityKeys: [membersKey(companyId), COMPANY_STATE_KEY],
    });
};

export const useTransferOwnership = () => {
  const transferOwnership = useAtomSet(transferOwnershipAtom, { mode: "promiseExit" });
  return (companyId: string, toUserId: string) =>
    transferOwnership({
      params: { companyId },
      payload: { to_user_id: toUserId },
      reactivityKeys: [membersKey(companyId), COMPANY_STATE_KEY],
    });
};
