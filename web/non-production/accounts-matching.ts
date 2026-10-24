import type { PageAccount } from "./page-props";

export const FILTER_SHOWN_ABOVE_ACCOUNT_COUNT = 8;

export const accountsMatching = (accounts: readonly PageAccount[], query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  return accounts.filter(({ name, email }) =>
    `${name} ${email}`.toLowerCase().includes(normalizedQuery),
  );
};
