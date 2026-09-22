import { spyOn } from "bun:test";

const originalFetch = globalThis.fetch;

export const stubFetch = (response: Response) =>
  spyOn(globalThis, "fetch").mockResolvedValue(response);

export const restoreFetch = (): void => {
  globalThis.fetch = originalFetch;
};

export const postInit = (body?: unknown) => ({
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
