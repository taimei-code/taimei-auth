import { Exit } from "effect";

import type { CompanyState } from "@core/account/account-contract";
import type { Unauthorized } from "@core/membership/guard/errors";

import { hasFailureTag } from "../shared/failure-message";

export type AccountEntry = { kind: "signIn" } | { kind: "companySignup" } | { kind: "show" };

export const accountEntryOf = (state: Exit.Exit<CompanyState, Unauthorized>): AccountEntry => {
  if (Exit.isFailure(state)) {
    return hasFailureTag(state.cause, "Unauthorized") ? { kind: "signIn" } : { kind: "show" };
  }
  return state.value.memberships.length === 0 ? { kind: "companySignup" } : { kind: "show" };
};
