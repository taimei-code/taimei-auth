import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { AccountGroup } from "@core/account/account-contract";

import { SpaApiClient } from "../shared/spa-api-client";

export const COMPANY_STATE_KEY = "company-state";

export const companyStateAtom = SpaApiClient.query("account", "memberships", {
  reactivityKeys: [COMPANY_STATE_KEY],
});
const switchCompanyAtom = SpaApiClient.mutation("account", "switchCompany");
const deleteAccountAtom = SpaApiClient.mutation("account", "deleteAccount");

// 切替の atom は画面の間で 1 つなので、実行中に別の画面から呼ぶと前の呼び出しが中断される
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
