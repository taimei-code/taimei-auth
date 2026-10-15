import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Data, Effect } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { AccountGroup } from "@core/account/account-contract";

import { authClient } from "../auth/auth-client";
import { SpaApiClient } from "../shared/spa-api-client";

export const COMPANY_STATE_KEY = "company-state";

export const companyStateAtom = SpaApiClient.query("account", "memberships", {
  reactivityKeys: [COMPANY_STATE_KEY],
});
const switchCompanyAtom = SpaApiClient.mutation("account", "switchCompany");
const deleteAccountAtom = SpaApiClient.mutation("account", "deleteAccount");

export const useSwitchCompanyRequest = () => {
  const switchCompany = useAtomSet(switchCompanyAtom, { mode: "promiseExit" });
  const pending = AsyncResult.isWaiting(useAtomValue(switchCompanyAtom));
  const request = (companyId: string) =>
    switchCompany({ payload: { company_id: companyId }, reactivityKeys: [COMPANY_STATE_KEY] });
  return { request, pending };
};

export const useDeleteAccount = () => {
  const deleteAccount = useAtomSet(deleteAccountAtom, { mode: "promiseExit" });
  return () => deleteAccount({});
};

export const AVATAR_UPLOAD_TOKEN_PATH = AccountGroup.endpoints.avatarUploadToken.path;

export class AuthClientReadFailed extends Data.TaggedError("AuthClientReadFailed")<{
  readonly status: number;
}> {}

type AuthClientResponse<A> = {
  readonly data: A | null;
  readonly error: { readonly status: number } | null;
};

export const readAuthClient = <A>(read: () => Promise<AuthClientResponse<A>>) =>
  Effect.promise(read).pipe(
    Effect.flatMap(({ data, error }) =>
      error === null
        ? Effect.orDie(Effect.fromNullishOr(data))
        : Effect.fail(new AuthClientReadFailed({ status: error.status })),
    ),
  );

export const sessionsAtom = Atom.make(readAuthClient(() => authClient.listSessions()));

export const linkedAccountsAtom = Atom.make(readAuthClient(() => authClient.listAccounts()));
