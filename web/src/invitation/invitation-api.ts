import type { Role } from "@core/membership/policy";

import { getJson, postJson } from "../shared/request-json";

export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
};

export async function listInvitations(companyId: string): Promise<PendingInvitation[]> {
  const response = await getJson<{ invitations: PendingInvitation[] }>(
    `/api/account/companies/${companyId}/invitations`,
  );
  return response.invitations;
}

export function createInvitation(
  companyId: string,
  params: { email: string; role: Role },
): Promise<{ reused: boolean }> {
  return postJson<{ reused: boolean }>(`/api/account/companies/${companyId}/invitations`, params);
}

export async function revokeInvitation(companyId: string, invitationId: string): Promise<void> {
  await postJson<{ ok: true }>(
    `/api/account/companies/${companyId}/invitations/${invitationId}/revoke`,
  );
}

export function acceptInvitation(invitationToken: string): Promise<{ company_id: string }> {
  return postJson<{ company_id: string }>("/api/account/accept-invitation", {
    invitation_token: invitationToken,
  });
}
