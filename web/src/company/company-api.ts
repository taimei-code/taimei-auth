import type { OrgCode } from "@core/company/org-code";

import { postJson } from "../shared/request-json";

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

type CreateCompanyParams = { name: string; org_code: OrgCode };

export const createCompany = (params: CreateCompanyParams): Promise<CreateCompanyResult> =>
  postJson<CreateCompanyResult>("/api/account/companies", params);

export const addCompany = (params: CreateCompanyParams): Promise<CreateCompanyResult> =>
  postJson<CreateCompanyResult>("/api/account/companies/add", params);

export async function updateCompany(
  companyId: string,
  params: { name: string; org_code: OrgCode },
): Promise<void> {
  await postJson<void>(`/api/account/companies/${companyId}`, params);
}

export async function deleteCompany(companyId: string): Promise<{ accountDeleted: boolean }> {
  const response = await postJson<{ ok: true; account_deleted: boolean }>(
    `/api/account/companies/${companyId}/delete`,
  );
  return { accountDeleted: response.account_deleted };
}

export type { OrgCode } from "@core/company/org-code";
