import { LogOut } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { redirectAfterAuthChange } from "@/lib/auth-redirect";

export const SignOutButton = () => {
  const signOutAndRedirect = () => {
    authClient
      .signOut()
      .then(({ error }) => {
        // signOut 失敗時に redirect すると、サーバー session が残ったままトップに飛び、
        // SessionGuard が再 mount で「session 有効」と判定してリダイレクトループになる経路がある。
        // 失敗ケースは redirect せずユーザーに留まらせる。
        if (error) {
          console.error("signOut failed:", error);
          return;
        }
        redirectAfterAuthChange("signOut");
      })
      .catch((error: unknown) => {
        console.error("signOut failed:", error);
      });
  };

  return (
    <button
      type="button"
      onClick={signOutAndRedirect}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <LogOut className="size-4" aria-hidden="true" />
      ログアウト
    </button>
  );
};
