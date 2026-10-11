import { SpaApiClient } from "../shared/spa-api-client";

export const createCompanyAtom = SpaApiClient.mutation("company", "create");
export const addCompanyAtom = SpaApiClient.mutation("company", "add");
export const updateCompanyAtom = SpaApiClient.mutation("company", "update");
export const deleteCompanyAtom = SpaApiClient.mutation("company", "delete");
