import { Exit } from "effect";
import type { AtomRegistry } from "effect/reactivity";

import type { CompanyState } from "@core/account/account-contract";

import { companyStateAtom } from "../account/account-atom";
import { authClient } from "../auth/auth-client";
import { readResult } from "../shared/atom-runtime";
import type { RouteEntry } from "../shared/route-entry";

export type CompanySignupEntry = Extract<
  RouteEntry,
  { kind: "signIn" | "goToRedirectUrl" | "show" }
>;

type CompanySignupInput =
  | { hasSession: false }
  | { hasSession: true; companyState: Exit.Exit<CompanyState, unknown>; redirectUrl: string };

export const companySignupEntryOf = (input: CompanySignupInput): CompanySignupEntry => {
  if (!input.hasSession) return { kind: "signIn" };
  const { companyState, redirectUrl } = input;
  return Exit.isSuccess(companyState) && companyState.value.memberships.length > 0
    ? { kind: "goToRedirectUrl", redirectUrl }
    : { kind: "show" };
};

export const readCompanySignupEntry = async (
  registry: AtomRegistry.AtomRegistry,
  signal: AbortSignal,
  redirectUrl: string,
  readSession: () => Promise<{ readonly data: { readonly session: unknown } | null }> = () =>
    authClient.getSession(),
): Promise<CompanySignupEntry> => {
  const session = await readSession().then(
    ({ data }) => (data?.session ? "present" : "absent"),
    () => "unknown" as const,
  );
  if (session === "unknown") return { kind: "show" };
  if (session === "absent") return companySignupEntryOf({ hasSession: false });
  const companyState = await readResult(registry, companyStateAtom, signal);
  return companySignupEntryOf({ hasSession: true, companyState, redirectUrl });
};
