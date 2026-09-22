import { useEffect, type ReactNode } from "react";

import { useCurrentCompany } from "../account/current-company";
import { redirectToCompanySignup, redirectToSignIn } from "../auth/auth-redirect";
import { FullScreenLoader } from "../shared/FullScreenLoader";

export const SessionGuard = ({ children }: { children: ReactNode }) => {
  const { loading, unauthorized, loadFailed, memberships } = useCurrentCompany();
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

  // redirect 開始後も loader を出し続ける (loading だけにすると children が一瞬描画される)
  if (loading || unauthorized || needsCompanySignup) {
    return <FullScreenLoader />;
  }

  return <>{children}</>;
};
