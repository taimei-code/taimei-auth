import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { createContext, use, useCallback, useMemo, type ReactNode } from "react";

import type { CompanyState } from "@core/account/account-contract";
import type { Unauthorized } from "@core/membership/guard/errors";

import { useRefreshAndWait } from "../shared/atom-runtime";
import { notifyAfterRefresh, notifyError } from "../shared/notify";
import { companyStateAtom, switchCompanyAtom } from "./account-atom";

export type Membership = CompanyState["memberships"][number];

type CompanyStateView = {
  loading: boolean;
  memberships: readonly Membership[];
  currentCompanyId: string | null;
  currentMembership: Membership | null;
};

type CurrentCompanyContextValue = CompanyStateView & {
  refresh: () => Promise<void>;
};

const CurrentCompanyContext = createContext<CurrentCompanyContextValue | null>(null);

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
  const refreshCompanyState = useRefreshAndWait(companyStateAtom);
  const refresh = useCallback(
    () => refreshCompanyState().then(() => undefined),
    [refreshCompanyState],
  );

  const value = useMemo(() => ({ ...toCompanyStateView(result), refresh }), [result, refresh]);

  return <CurrentCompanyContext value={value}>{children}</CurrentCompanyContext>;
};

export const useCurrentCompany = (): CurrentCompanyContextValue => {
  const context = use(CurrentCompanyContext);
  if (!context) {
    throw new Error("useCurrentCompany must be used within CurrentCompanyProvider");
  }
  return context;
};

// 切替の atom は画面の間で 1 つなので、実行中に別の画面から呼ぶと前の呼び出しが中断される
export const useSwitchCompany = () => {
  const { refresh } = useCurrentCompany();
  const requestSwitch = useAtomSet(switchCompanyAtom, { mode: "promiseExit" });
  const switchPending = AsyncResult.isWaiting(useAtomValue(switchCompanyAtom));
  const switchCompany = (companyId: string): Promise<void> =>
    switchPending
      ? Promise.resolve()
      : requestSwitch({ payload: { company_id: companyId } }).then(
          Exit.match({
            onSuccess: () => notifyAfterRefresh(refresh, { staleShort: "事業所を切り替えました" }),
            onFailure: () => notifyError("事業所を切り替えられませんでした。"),
          }),
        );
  return { switchCompany, switchPending };
};
