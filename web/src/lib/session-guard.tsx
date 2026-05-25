import { type ReactNode, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { listMyMemberships } from "@/lib/account-api";

type Status = "loading" | "authenticated";

export const SessionGuard = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const redirectTo = (path: string) => {
      const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
      window.location.replace(
        `${path}?service_name=accounts&redirect_url=${encodeURIComponent(returnTo)}`,
      );
    };

    authClient
      .getSession()
      .then(({ data }) => {
        if (!data?.session) {
          redirectTo("/auth/");
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
          redirectTo("/auth/signup/company");
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
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
};
