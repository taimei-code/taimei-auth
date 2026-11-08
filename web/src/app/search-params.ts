export const parseSearch = (searchStr: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(searchStr));

export const stringifySearch = (search: Record<string, unknown>): string => {
  const entries = Object.entries(search).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, typeof value === "string" ? value : JSON.stringify(value)]],
  );
  const searchStr = new URLSearchParams(entries).toString();
  return searchStr ? `?${searchStr}` : "";
};
