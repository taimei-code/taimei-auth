import { redirect } from "@tanstack/react-router";

import { companySignupUrlReturningTo } from "../shared/leave-spa";
import type { RedirectingEntry } from "../shared/route-entry";

export const redirectFor = (entry: RedirectingEntry, href: string): ReturnType<typeof redirect> => {
  switch (entry.kind) {
    case "companySignup":
      return redirect({
        href: companySignupUrlReturningTo(href),
        reloadDocument: true,
        replace: true,
      });
  }
};
