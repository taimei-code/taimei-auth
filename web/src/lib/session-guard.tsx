import { useEffect, type ReactNode } from "react";

import { FullScreenLoader } from "@/components/FullScreenLoader";
import { redirectToCompanySignup, redirectToSignIn } from "@/lib/auth-redirect";
import { useCompanyContext } from "@/lib/company-context";

// /account 配下の入口ガード。認証判定は CompanyProvider の memberships fetch (401 = 未認証) に
// 相乗りし、getSession → memberships の直列 2 round trip を作らない。
// - 未認証 (401) → 共通ログインへ full reload 遷移 (mount 済み画面に副作用を残さない)
// - membership 0 件 → signup/company へ (ADR-009: 事業所未確定は /account 操作を許可しない。
//   session.user の lastUsedCompanyId は better-auth cookieCache (5min) に乗るため CreateCompany
//   直後は stale=null になりループする。DB を引く membership API を権威ソースにする)
// - 401 以外の取得失敗 → guard を通過させ、各 page 側で再取得に委ねる (誤遮断を避ける)
export const SessionGuard = ({ children }: { children: ReactNode }) => {
  const { loading, unauthorized, loadFailed, memberships } = useCompanyContext();
  const needsCompanySignup = !loadFailed && memberships.length === 0;

  useEffect(() => {
    if (loading) return;
    if (unauthorized) {
      redirectToSignIn();
      return;
    }
    if (needsCompanySignup) {
      redirectToCompanySignup();
    }
  }, [loading, unauthorized, needsCompanySignup]);

  // redirect 発火後も unmount まで loader を出し続ける (children の一瞬の描画を防ぐ)。
  if (loading || unauthorized || needsCompanySignup) {
    return <FullScreenLoader />;
  }

  return <>{children}</>;
};
