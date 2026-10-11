// router の既定 (qss) は "123" を数に、"true" を boolean にするので、consumer と server が組む文字列の query をそのまま読む
export const parseSearch = (searchStr: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(searchStr));

export const stringifySearch = (search: Record<string, unknown>): string => {
  const entries = Object.entries(search).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, String(value)]],
  );
  const searchStr = new URLSearchParams(entries).toString();
  return searchStr ? `?${searchStr}` : "";
};
