import type { Role } from "@core/membership/policy";

import { getJson, postJson } from "../shared/request-json";

export type Member = {
  membership_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: string;
  joined_at: string;
};

export async function listMembers(companyId: string): Promise<Member[]> {
  const response = await getJson<{ members: Member[] }>(
    `/api/account/companies/${companyId}/members`,
  );
  return response.members;
}

export async function updateMemberRole(
  companyId: string,
  targetUserId: string,
  role: Role,
): Promise<void> {
  await postJson<{ ok: true }>(`/api/account/companies/${companyId}/members/${targetUserId}/role`, {
    role,
  });
}

export async function removeMember(
  companyId: string,
  targetUserId: string,
): Promise<{ accountDeleted: boolean }> {
  const response = await postJson<{ ok: true; account_deleted: boolean }>(
    `/api/account/companies/${companyId}/members/${targetUserId}/remove`,
  );
  return { accountDeleted: response.account_deleted };
}

export async function transferOwnership(companyId: string, toUserId: string): Promise<void> {
  await postJson<{ ok: true }>(`/api/account/companies/${companyId}/transfer-ownership`, {
    to_user_id: toUserId,
  });
}
