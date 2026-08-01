import { type ReactNode, useEffect, useState } from "react";

import { FullScreenLoader } from "@/components/FullScreenLoader";
import { authClient } from "@/lib/auth-client";
import { listMyMemberships } from "@/lib/account-api";
import { redirectToSignIn } from "@/lib/auth-redirect";

type Status = "loading" | "authenticated";

export const SessionGuard = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    authClient
      .getSession()
      .then(({ data }) => {
        if (!data?.session) {
          redirectToSignIn();
          return null;
        }
        // ADR-009: 「事業所未確定」(membership 0 件) は /account 操作を許可せず signup/company へ誘導。
        // session.user の lastUsedCompanyId は better-auth cookieCache (5min) に乗るため、
        // CreateCompany 直後は stale=null になりループする。DB を引く membership API を権威ソースにする。
        return listMyMemberships();
      })
      .then((memberships) => {
        if (memberships === null) return; // 未認証で既に redirect 済
        if (memberships.length === 0) {
          redirectToSignIn("/auth/signup/company");
          return;
        }
        setStatus("authenticated");
      })
      .catch((e) => {
        // membership 取得失敗は guard を通過させ、各 page 側で再取得に委ねる (誤遮断を避ける)。
        console.error("membership check failed in SessionGuard", e);
        setStatus("authenticated");
      });
  }, []);

  if (status === "loading") {
    return <FullScreenLoader />;
  }

  return <>{children}</>;
};
