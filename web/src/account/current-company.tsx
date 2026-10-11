import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { createContext, use, useCallback, useMemo, type ReactNode } from "react";

import type { Role } from "@core/membership/policy";

import { atomRuntime, refreshAndWait } from "../shared/atom-runtime";
import { RequestJsonError, fromRequestJson, getJson, postJson } from "../shared/request-json";

export type Membership = {
  id: string;
  company_id: string;
  company_name: string;
  company_org_code: string;
  role: Role;
  joined_at: string;
};

export type CompanyState = {
  current_company_id: string | null;
  memberships: Membership[];
};

export const getCompanyState = (): Promise<CompanyState> =>
  getJson<CompanyState>("/api/account/memberships");

export const listMyMemberships = (): Promise<Membership[]> =>
  getCompanyState().then((state) => state.memberships);

export const setCurrentCompany = async (companyId: string): Promise<void> => {
  await postJson<{ ok: true }>("/api/account/current-company", { company_id: companyId });
};

type CurrentCompanyContextValue = {
  loading: boolean;
  unauthorized: boolean;
  loadFailed: boolean;
  memberships: Membership[];
  currentCompanyId: string | null;
  currentMembership: Membership | null;
  refresh: () => Promise<void>;
};

const CurrentCompanyContext = createContext<CurrentCompanyContextValue | null>(null);

const companyStateAtom = atomRuntime.atom(fromRequestJson(getCompanyState));

export const CurrentCompanyProvider = ({ children }: { children: ReactNode }) => {
  const registry = use(RegistryContext);
  const result = useAtomValue(companyStateAtom);

  const refresh = useCallback(
    () => refreshAndWait(registry, companyStateAtom).then(() => undefined),
    [registry],
  );

  const value = useMemo<CurrentCompanyContextValue>(() => {
    const state = Option.getOrNull(AsyncResult.value(result));
    const failed = state === null && AsyncResult.isFailure(result);
    const failure = failed ? Option.getOrNull(AsyncResult.error(result)) : null;
    const unauthorized = failure instanceof RequestJsonError && failure.status === 401;
    const memberships = state?.memberships ?? [];
    const currentCompanyId = state?.current_company_id ?? null;
    return {
      loading: AsyncResult.isInitial(result),
      unauthorized,
      loadFailed: failed && !unauthorized,
      memberships,
      currentCompanyId,
      currentMembership:
        memberships.find((membership) => membership.company_id === currentCompanyId) ?? null,
      refresh,
    };
  }, [result, refresh]);

  return <CurrentCompanyContext value={value}>{children}</CurrentCompanyContext>;
};

export const useCurrentCompany = (): CurrentCompanyContextValue => {
  const context = use(CurrentCompanyContext);
  if (!context) {
    throw new Error("useCurrentCompany must be used within CurrentCompanyProvider");
  }
  return context;
};
