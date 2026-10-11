import { Exit } from "effect";
import type { AtomRegistry } from "effect/reactivity";

import type { CompanyState } from "@core/account/account-contract";
import type { Unauthorized } from "@core/membership/guard/errors";

import { companyStateAtom } from "../account/account-atom";
import { authClient } from "../auth/auth-client";
import { readResult } from "../shared/atom-runtime";
import { hasFailureTag } from "../shared/failure-message";

export type CompanySignupEntry =
  | { kind: "signIn" }
  | { kind: "goToRedirectUrl" }
  | { kind: "discardStaleSession" }
  | { kind: "form" };

type CompanySignupInput =
  | { hasSession: false }
  | { hasSession: true; companyState: Exit.Exit<CompanyState, Unauthorized> };

export const companySignupEntryOf = (input: CompanySignupInput): CompanySignupEntry => {
  if (!input.hasSession) return { kind: "signIn" };
  const { companyState } = input;
  if (Exit.isSuccess(companyState)) {
    return companyState.value.memberships.length > 0
      ? { kind: "goToRedirectUrl" }
      : { kind: "form" };
  }
  return hasFailureTag(companyState.cause, "Unauthorized")
    ? { kind: "discardStaleSession" }
    : { kind: "form" };
};

export const readCompanySignupEntry = async (
  registry: AtomRegistry.AtomRegistry,
  signal: AbortSignal,
): Promise<CompanySignupEntry> => {
  const session = await authClient.getSession().then(
    ({ data }) => (data?.session ? "present" : "absent"),
    () => "unknown" as const,
  );
  if (session === "unknown") return { kind: "form" };
  if (session === "absent") return companySignupEntryOf({ hasSession: false });
  const companyState = await readResult(registry, companyStateAtom, signal);
  return companySignupEntryOf({ hasSession: true, companyState });
};
