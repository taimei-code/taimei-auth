import { spyOn } from "bun:test";

// fetch の stub と復元を生成する唯一の場所。ファイルごとに originalFetch の退避を書き写すと復元漏れが
// 再発しやすいため、対で使う stubFetch と restoreFetch をここに置く。
const originalFetch = globalThis.fetch;

export const stubFetch = (response: Response) =>
  spyOn(globalThis, "fetch").mockResolvedValue(response);

export const restoreFetch = (): void => {
  globalThis.fetch = originalFetch;
};

// postJson が送る RequestInit の期待値。init の内訳は shared/__tests__/request-json.test.ts が
// 定義元として固定し、domain の api テストは「postJson 経由で既存の contract を保つ」ことだけを主張する。
export const postInit = (body?: unknown) => ({
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
