import { redirect } from "@tanstack/react-router";

import { companySignupUrlReturningTo, signInUrlReturningTo } from "../shared/leave-spa";
import type { RedirectingEntry } from "../shared/route-entry";

const fullReload = { reloadDocument: true, replace: true } as const;

export const redirectFor = (entry: RedirectingEntry, href: string): ReturnType<typeof redirect> => {
  switch (entry.kind) {
    case "signIn":
      return redirect({ href: signInUrlReturningTo(href), ...fullReload });
    case "goToRedirectUrl":
      return redirect({ href: entry.redirectUrl, ...fullReload });
    case "companySignup":
      return redirect({ href: companySignupUrlReturningTo(href), ...fullReload });
  }
};
