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

export async function listMyMemberships(): Promise<Membership[]> {
  const res = await fetch("/api/account/memberships", { credentials: "include" });
  if (!res.ok) {
    throw new AccountApiError(res.status, `listMemberships failed: ${res.status}`);
  }
  const json = (await res.json()) as { memberships: Membership[] };
  return json.memberships;
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
