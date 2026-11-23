import type { PageAccount } from "./page-props";

export const FILTER_SHOWN_ABOVE_ITEM_COUNT = 8;

export const itemsMatching = <Item>(
  items: readonly Item[],
  query: string,
  searchableTextOf: (item: Item) => string,
) => {
  const normalizedQuery = query.trim().toLowerCase();
  return items.filter((item) => searchableTextOf(item).toLowerCase().includes(normalizedQuery));
};

export const accountsMatching = (accounts: readonly PageAccount[], query: string) =>
  itemsMatching(accounts, query, ({ name, email }) => `${name} ${email}`);

export const withQuery = <Model extends { readonly query: string }>(
  model: Model,
  query: string,
): Model => ({ ...model, query });
