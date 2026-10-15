import { Exit } from "effect";

import type { CompanyState } from "@core/account/account-contract";

import type { RouteEntry } from "../shared/route-entry";

export type AccountEntry = Extract<RouteEntry, { kind: "companySignup" | "show" }>;

export const accountEntryOf = (state: Exit.Exit<CompanyState, unknown>): AccountEntry =>
  Exit.isSuccess(state) && state.value.memberships.length === 0
    ? { kind: "companySignup" }
    : { kind: "show" };
