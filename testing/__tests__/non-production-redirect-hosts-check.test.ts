import { describe, expect, test } from "bun:test";
import {
  usesNonProductionRedirectHosts,
  REDIRECT_HOSTS_NOT_SWAPPED_IN_WORKER,
  serveOnlyWithNonProductionRedirectHosts,
} from "../non-production-redirect-hosts-check";

const servedRequests: string[] = [];

const entryWith = (inEffect: () => boolean) =>
  serveOnlyWithNonProductionRedirectHosts<undefined, undefined>(inEffect, {
    fetch: async (req) => {
      servedRequests.push(new URL(req.url).pathname);
      return new Response("served");
    },
  });

const fetchHealth = (inEffect: () => boolean) => {
  servedRequests.length = 0;
  return entryWith(inEffect).fetch(new Request("http://localhost/health"), undefined, undefined);
};

describe("本番以外の entry は、redirect 先の allowlist が本番以外の値に差し替わっている時だけ動く", () => {
  test("bun test は bunfig の preload で差し替わっている", () => {
    expect(usesNonProductionRedirectHosts()).toBe(true);
  });

  test("差し替わっていなければ、app を呼ばずに 500 と止めた理由を返す", async () => {
    const response = await fetchHealth(() => false);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe(REDIRECT_HOSTS_NOT_SWAPPED_IN_WORKER);
    expect(servedRequests).toEqual([]);
  });

  test("差し替わっていれば、app に渡す", async () => {
    const response = await fetchHealth(() => true);

    expect(await response.text()).toBe("served");
    expect(servedRequests).toEqual(["/health"]);
  });
});
