import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  AccountApiError,
  getCompanyState,
  setCurrentCompany,
  type Membership,
} from "@/lib/account-api";

type CompanyContextValue = {
  loading: boolean;
  // 初回ロードが 401 で失敗 = 未認証。SessionGuard がログイン画面へ倒すために参照する
  // (memberships fetch 自体が認証を要求するため、別途 getSession を呼ぶ round trip を作らない)。
  unauthorized: boolean;
  // 初回ロードが 401 以外で失敗 (一時的なネットワーク断等)。SessionGuard はこの場合
  // 「membership 0 件 → signup 誘導」と誤判定せず guard を通過させる (誤遮断を避ける)。
  loadFailed: boolean;
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
  const [unauthorized, setUnauthorized] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    const state = await getCompanyState();
    setMemberships(state.memberships);
    setCurrentCompanyId(state.current_company_id);
  }, []);

  useEffect(() => {
    refresh()
      .catch((e) => {
        if (e instanceof AccountApiError && e.status === 401) {
          setUnauthorized(true);
          return;
        }
        console.error("failed to load company state", e);
        setLoadFailed(true);
      })
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
      unauthorized,
      loadFailed,
      memberships,
      currentCompanyId,
      currentMembership,
      refresh,
      switchCompany,
    };
  }, [loading, unauthorized, loadFailed, memberships, currentCompanyId, refresh, switchCompany]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
};

export const useCompanyContext = (): CompanyContextValue => {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error("useCompanyContext must be used within CompanyProvider");
  }
  return ctx;
};
