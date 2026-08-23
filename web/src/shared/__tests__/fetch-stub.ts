import { spyOn } from "bun:test";

// fetch stub と復元の唯一の生成点。file ごとに originalFetch の退避を書き写すと復元漏れが
// 再発しやすいため、対で使う stubFetch / restoreFetch をここに置く。
const originalFetch = globalThis.fetch;

export const stubFetch = (response: Response) =>
  spyOn(globalThis, "fetch").mockResolvedValue(response);

export const restoreFetch = (): void => {
  globalThis.fetch = originalFetch;
};

// postJson が送る RequestInit の期待値。init の内訳の正本は shared/__tests__/request-json.test.ts が
// 固定し、domain api test は「postJson 経由で既存 contract を保つ」ことだけを主張する。
export const postInit = (body?: unknown) => ({
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
