// SPA → auth-service の事業所操作 API client。
// Connect RPC (/rpc/*) は X-Service-Key 必須 = browser から呼べないため、
// セッション cookie 信頼の /api/account/* Hono 直 fetch に分離する。

export type Membership = {
  id: string;
  company_id: string;
  company_name: string;
  company_org_code: string;
  role: string;
  joined_at: string;
};

export type CreateCompanyResult = {
  company: {
    id: string;
    name: string;
    org_code: string;
    activation_status: string;
    created_at: string;
  };
  membership: {
    id: string;
    role: string;
    company_id: string;
    joined_at: string;
  };
};

export class AccountApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AccountApiError";
  }
}

export type CompanyState = {
  current_company_id: string | null;
  memberships: Membership[];
};

export async function getCompanyState(): Promise<CompanyState> {
  const res = await fetch("/api/account/memberships", { credentials: "include" });
  if (!res.ok) {
    throw new AccountApiError(res.status, `getCompanyState failed: ${res.status}`);
  }
  return (await res.json()) as CompanyState;
}

export async function listMyMemberships(): Promise<Membership[]> {
  return (await getCompanyState()).memberships;
}

export async function createCompany(params: {
  name: string;
  org_code: "PERSONAL" | "CORPORATE";
}): Promise<CreateCompanyResult> {
  const res = await fetch("/api/account/companies", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AccountApiError(res.status, text || `createCompany failed: ${res.status}`);
  }
  return (await res.json()) as CreateCompanyResult;
}

export type CompanyRole = "OWNER" | "ADMIN" | "MEMBER";

export type Member = {
  membership_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: string;
  joined_at: string;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new AccountApiError(res.status, `GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AccountApiError(res.status, text || `POST ${url} failed: ${res.status}`);
  }
  // 204 / 空ボディでも壊れないよう text を経由して parse する (JSON でなければ undefined)。
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function listMembers(companyId: string): Promise<Member[]> {
  const json = await getJson<{ members: Member[] }>(`/api/account/companies/${companyId}/members`);
  return json.members;
}

export async function listInvitations(companyId: string): Promise<PendingInvitation[]> {
  const json = await getJson<{ invitations: PendingInvitation[] }>(
    `/api/account/companies/${companyId}/invitations`,
  );
  return json.invitations;
}

export async function createInvitation(
  companyId: string,
  params: { email: string; role: CompanyRole },
): Promise<{ reused: boolean }> {
  return postJson<{ reused: boolean }>(`/api/account/companies/${companyId}/invitations`, params);
}

export async function revokeInvitation(companyId: string, invitationId: string): Promise<void> {
  await postJson<{ ok: true }>(
    `/api/account/companies/${companyId}/invitations/${invitationId}/revoke`,
  );
}

export async function acceptInvitation(invitationToken: string): Promise<{ company_id: string }> {
  return postJson<{ company_id: string }>("/api/account/accept-invitation", {
    invitation_token: invitationToken,
  });
}

export async function setCurrentCompany(companyId: string): Promise<void> {
  await postJson<{ ok: true }>("/api/account/current-company", { company_id: companyId });
}

export async function updateMemberRole(
  companyId: string,
  targetUserId: string,
  role: CompanyRole,
): Promise<void> {
  await postJson<{ ok: true }>(`/api/account/companies/${companyId}/members/${targetUserId}/role`, {
    role,
  });
}

export async function removeMember(companyId: string, targetUserId: string): Promise<void> {
  await postJson<{ ok: true }>(
    `/api/account/companies/${companyId}/members/${targetUserId}/remove`,
  );
}
