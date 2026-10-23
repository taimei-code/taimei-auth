import { Schema } from "effect";
import { html } from "hono/html";
import type { listAccounts } from "../db/testing/dev-accounts";

export const ChosenUser = Schema.Struct({ userId: Schema.String });

export type Account = Awaited<ReturnType<typeof listAccounts>>[number];

export const activeCompanyItemsOf = (account: Account) =>
  account.memberships
    .filter(({ company }) => company.activationStatus === "ACTIVE")
    .map(({ company, role }) => html`<li>${company.name}: ${role}</li>`);
