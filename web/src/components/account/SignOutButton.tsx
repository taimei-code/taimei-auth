import { LogOut } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { redirectAfterAuthChange } from "@/lib/auth-redirect";
import { notifyError } from "@/components/notify";

const SIGN_OUT_FAILED = "ログアウトに失敗しました。しばらくしてから再度お試しください。";

const signOutAndRedirect = () => {
  authClient
    .signOut()
    .then(({ error }) => {
      // 失敗時に redirect すると server session が残ったまま SessionGuard 再 mount で再ログイン判定になり
      // リダイレクトループに入る。失敗ケースは redirect せずユーザーに留まらせる
      if (error) {
        notifyError(SIGN_OUT_FAILED);
        return;
      }
      redirectAfterAuthChange("signOut");
    })
    .catch(() => notifyError(SIGN_OUT_FAILED));
};

export const SignOutButton = () => {
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
