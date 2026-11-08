import { SpaApiClient } from "../shared/spa-api-client";

export const COMPANY_STATE_KEY = "company-state";

export const companyStateAtom = SpaApiClient.query("account", "memberships", {
  reactivityKeys: [COMPANY_STATE_KEY],
});
