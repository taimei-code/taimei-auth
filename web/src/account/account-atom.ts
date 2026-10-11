import { SpaApiClient } from "../shared/spa-api-client";

export const companyStateAtom = SpaApiClient.query("account", "memberships", {});
export const switchCompanyAtom = SpaApiClient.mutation("account", "switchCompany");
export const deleteAccountAtom = SpaApiClient.mutation("account", "deleteAccount");
