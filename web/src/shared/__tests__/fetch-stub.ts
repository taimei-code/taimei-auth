import { spyOn } from "bun:test";

const originalFetch = globalThis.fetch;

export const stubFetch = (response: Response) =>
  spyOn(globalThis, "fetch").mockResolvedValue(response);

export const restoreFetch = (): void => {
  globalThis.fetch = originalFetch;
};
