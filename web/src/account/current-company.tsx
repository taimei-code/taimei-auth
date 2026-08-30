import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { RequestJsonError, getJson, postJson } from "../shared/request-json";

export type Membership = {
  id: string;
  company_id: string;
  company_name: string;
  company_org_code: string;
  role: string;
  joined_at: string;
};

export type CompanyState = {
  current_company_id: string | null;
  memberships: Membership[];
};

export const getCompanyState = (): Promise<CompanyState> =>
  getJson<CompanyState>("/api/account/memberships");

// 事業所登録 guard 用の projection。専用 endpoint を足すと同じ state が 2 経路で読まれる。
export const listMyMemberships = (): Promise<Membership[]> =>
  getCompanyState().then((state) => state.memberships);

export const setCurrentCompany = async (companyId: string): Promise<void> => {
  await postJson<{ ok: true }>("/api/account/current-company", { company_id: companyId });
};

type CurrentCompanyContextValue = {
  loading: boolean;
  // 初回ロードが 401 で失敗 = 未認証。getSession の round trip を足さず SessionGuard がこれを参照する。
  unauthorized: boolean;
  // 401 以外の失敗。SessionGuard は「membership 0 件 → signup 誘導」と誤判定せず通過させる (誤遮断を避ける)。
  loadFailed: boolean;
  memberships: Membership[];
  currentCompanyId: string | null;
  currentMembership: Membership | null;
  refresh: () => Promise<void>;
};

const CurrentCompanyContext = createContext<CurrentCompanyContextValue | null>(null);

// /account 配下で現在の事業所 + 所属一覧を共有する。切替は setCurrentCompany → refresh の 2 段で行い、
// window.location.reload は使わない (入力中の未保存フォームが消えるため)。
export const CurrentCompanyProvider = ({ children }: { children: ReactNode }) => {
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
      .catch((error) => {
        if (error instanceof RequestJsonError && error.status === 401) {
          setUnauthorized(true);
          return;
        }
        console.error("failed to load company state", error);
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<CurrentCompanyContextValue>(() => {
    const currentMembership =
      memberships.find((membership) => membership.company_id === currentCompanyId) ??
      memberships.at(0) ??
      null;
    return {
      loading,
      unauthorized,
      loadFailed,
      memberships,
      currentCompanyId,
      currentMembership,
      refresh,
    };
  }, [loading, unauthorized, loadFailed, memberships, currentCompanyId, refresh]);

  return <CurrentCompanyContext value={value}>{children}</CurrentCompanyContext>;
};

export const useCurrentCompany = (): CurrentCompanyContextValue => {
  const context = use(CurrentCompanyContext);
  if (!context) {
    throw new Error("useCurrentCompany must be used within CurrentCompanyProvider");
  }
  return context;
};
