import { useState } from "react";
import { LogOut } from "lucide-react";

import { leaveSpaTo } from "../shared/leave-spa";
import { notifyError } from "../shared/notify";
import { SIGN_OUT_FAILED, signOut } from "./sign-out";

export const SignOutButton = () => {
  const [signingOut, setSigningOut] = useState(false);

  const signOutAndRedirect = () => {
    if (signingOut) return;
    setSigningOut(true);
    void signOut().then((result) => {
      if (result === "failed") {
        setSigningOut(false);
        notifyError(SIGN_OUT_FAILED);
        return;
      }
      leaveSpaTo("/");
    });
  };

  return (
    <button
      type="button"
      onClick={signOutAndRedirect}
      disabled={signingOut}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <LogOut className="size-4" aria-hidden="true" />
      ログアウト
    </button>
  );
};
