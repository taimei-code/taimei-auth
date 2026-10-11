import { AsyncResult, Atom } from "effect/reactivity";

import type { Member, PendingInvitation } from "@core/membership/members-api";
import { AccountApiClient } from "../shared/account-api-client";

export const membersKey = (companyId: string) => `members:${companyId}`;
export const invitationsKey = (companyId: string) => `invitations:${companyId}`;

const noMembers = Atom.make(AsyncResult.success({ members: [] as readonly Member[] }));
const noInvitations = Atom.make(
  AsyncResult.success({ invitations: [] as readonly PendingInvitation[] }),
);

// key が事業所ごとに別の atom なので、切替前の事業所の応答は今の画面に届かない
export const membersOf = (companyId: string | null) =>
  companyId === null
    ? noMembers
    : AccountApiClient.query("members", "list", {
        params: { companyId },
        reactivityKeys: [membersKey(companyId)],
      });

// 招待一覧は ADMIN 未満だと 403 になるため、管理できない人は null を渡す
export const pendingInvitationsOf = (companyId: string | null) =>
  companyId === null
    ? noInvitations
    : AccountApiClient.query("members", "pendingInvitations", {
        params: { companyId },
        reactivityKeys: [invitationsKey(companyId)],
      });

export const changeRoleAtom = AccountApiClient.mutation("members", "changeRole");
export const removeMemberAtom = AccountApiClient.mutation("members", "remove");
