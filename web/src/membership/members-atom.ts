import { AsyncResult, Atom } from "effect/reactivity";

import type { PendingInvitation } from "@core/invitation/invitation-contract";
import type { Member } from "@core/membership/membership-contract";
import { SpaApiClient } from "../shared/spa-api-client";

export const membersKey = (companyId: string) => `members:${companyId}`;
const invitationsKey = (companyId: string) => `invitations:${companyId}`;

const noMembers = Atom.make(AsyncResult.success({ members: [] as readonly Member[] }));
const noInvitations = Atom.make(
  AsyncResult.success({ invitations: [] as readonly PendingInvitation[] }),
);

// key が事業所ごとに別の atom なので、切替前の事業所の応答は今の画面に届かない
export const membersOf = (companyId: string | null) =>
  companyId === null
    ? noMembers
    : SpaApiClient.query("membership", "list", {
        params: { companyId },
        reactivityKeys: [membersKey(companyId)],
      });

// 招待一覧は ADMIN 未満だと 403 になるため、管理できない人は null を渡す
export const pendingInvitationsOf = (companyId: string | null) =>
  companyId === null
    ? noInvitations
    : SpaApiClient.query("invitation", "pending", {
        params: { companyId },
        reactivityKeys: [invitationsKey(companyId)],
      });

export const changeRoleAtom = SpaApiClient.mutation("membership", "changeRole");
export const removeMemberAtom = SpaApiClient.mutation("membership", "remove");
