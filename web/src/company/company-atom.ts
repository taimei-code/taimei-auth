import { useAtomSet } from "@effect/atom-react";

import type { OrgCode } from "@core/company/org-code";

import { COMPANY_STATE_KEY } from "../account/account-atom";
import { SpaApiClient } from "../shared/spa-api-client";

const createCompanyAtom = SpaApiClient.mutation("company", "create");
const addCompanyAtom = SpaApiClient.mutation("company", "add");
const updateCompanyAtom = SpaApiClient.mutation("company", "update");
const deleteCompanyAtom = SpaApiClient.mutation("company", "delete");

type CompanyInput = { name: string; org_code: OrgCode };

export const useCreateCompany = () => {
  const createCompany = useAtomSet(createCompanyAtom, { mode: "promiseExit" });
  return (payload: CompanyInput) => createCompany({ payload });
};

export const useAddCompany = () => {
  const addCompany = useAtomSet(addCompanyAtom, { mode: "promiseExit" });
  return (payload: CompanyInput) => addCompany({ payload, reactivityKeys: [COMPANY_STATE_KEY] });
};

export const useUpdateCompany = () => {
  const updateCompany = useAtomSet(updateCompanyAtom, { mode: "promiseExit" });
  return (companyId: string, payload: CompanyInput) =>
    updateCompany({ params: { companyId }, payload, reactivityKeys: [COMPANY_STATE_KEY] });
};

export const useDeleteCompany = () => {
  const deleteCompany = useAtomSet(deleteCompanyAtom, { mode: "promiseExit" });
  return (companyId: string) =>
    deleteCompany({ params: { companyId }, reactivityKeys: [COMPANY_STATE_KEY] });
};
