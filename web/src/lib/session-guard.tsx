import { type ReactNode, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";

// 認証ガード: Cookie 検証必須、未認証なら共通ログイン画面に誘導 (sign 流: service_name=accounts)。
// redirect_url には現在の URL を encode してそのまま渡し、ログイン後に元の画面へ戻す。
//
// loading 中は spinner のみ表示 (画面のチラつきを防ぐ)。
// 認証成功後は status が "authenticated" になり children を描画する。
type Status = "loading" | "authenticated";

export const SessionGuard = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    void (async () => {
      const { data } = await authClient.getSession();
      if (!data?.session) {
        const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
        const url = `/auth/?service_name=accounts&redirect_url=${encodeURIComponent(returnTo)}`;
        window.location.replace(url);
        return;
      }
      setStatus("authenticated");
    })();
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
