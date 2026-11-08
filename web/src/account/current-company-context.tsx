import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { createContext, use, useMemo, type ReactNode } from "react";

import type { CompanyState } from "@core/account/account-contract";
import type { Unauthorized } from "@core/failures";

import { companyStateAtom } from "./account-atom";

type Membership = CompanyState["memberships"][number];

type CompanyStateView = {
  loading: boolean;
  memberships: readonly Membership[];
  currentCompanyId: string | null;
  currentMembership: Membership | null;
};

const CurrentCompanyContext = createContext<CompanyStateView | null>(null);

const EMPTY_COMPANY_STATE: CompanyState = { current_company_id: null, memberships: [] };

const toCompanyStateView = (
  result: AsyncResult.AsyncResult<CompanyState, Unauthorized>,
): CompanyStateView => {
  const state = AsyncResult.getOrElse(result, () => EMPTY_COMPANY_STATE);
  return {
    loading: AsyncResult.isInitial(result),
    memberships: state.memberships,
    currentCompanyId: state.current_company_id,
    currentMembership:
      state.memberships.find((membership) => membership.company_id === state.current_company_id) ??
      null,
  };
};

export const CurrentCompanyProvider = ({ children }: { children: ReactNode }) => {
  const result = useAtomValue(companyStateAtom);
  const value = useMemo(() => toCompanyStateView(result), [result]);

  return <CurrentCompanyContext value={value}>{children}</CurrentCompanyContext>;
};

export const useCurrentCompany = (): CompanyStateView => {
  const context = use(CurrentCompanyContext);
  if (!context) {
    throw new Error("useCurrentCompany must be used within CurrentCompanyProvider");
  }
  return context;
};
