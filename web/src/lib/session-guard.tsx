import { type ReactNode, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";

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
