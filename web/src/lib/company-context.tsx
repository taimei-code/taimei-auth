import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getCompanyState, setCurrentCompany, type Membership } from "@/lib/account-api";

type CompanyContextValue = {
  loading: boolean;
  memberships: Membership[];
  currentCompanyId: string | null;
  currentMembership: Membership | null;
  refresh: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

// /account 配下で現在の事業所 + 所属一覧を共有する。事業所切替は user.last_used_company_id を
// 更新して state を再 fetch するだけ。window.location.reload は使わない (reload は入力中の
// 未保存フォームを消失させるため)。
export const CompanyProvider = ({ children }: { children: ReactNode }) => {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const state = await getCompanyState();
    setMemberships(state.memberships);
    setCurrentCompanyId(state.current_company_id);
  }, []);

  useEffect(() => {
    refresh()
      .catch((e) => console.error("failed to load company state", e))
      .finally(() => setLoading(false));
  }, [refresh]);

  const switchCompany = useCallback(
    async (companyId: string) => {
      await setCurrentCompany(companyId);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<CompanyContextValue>(() => {
    const currentMembership =
      memberships.find((m) => m.company_id === currentCompanyId) ?? memberships.at(0) ?? null;
    return {
      loading,
      memberships,
      currentCompanyId,
      currentMembership,
      refresh,
      switchCompany,
    };
  }, [loading, memberships, currentCompanyId, refresh, switchCompany]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
};

export const useCompanyContext = (): CompanyContextValue => {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error("useCompanyContext must be used within CompanyProvider");
  }
  return ctx;
};
