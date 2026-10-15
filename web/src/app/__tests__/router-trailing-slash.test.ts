import { describe, expect, test } from "bun:test";
import { AtomRegistry } from "effect/reactivity";

import { makeRouter } from "../router";

describe("router は /auth/ の末尾の / を保つ", () => {
  test("/auth/ を解決しても /auth/ のまま (TanStack Router の既定の never は /auth に変え、server の session-aware redirect を通らなくなる)", () => {
    const router = makeRouter(AtomRegistry.make());

    expect(
      router.buildLocation({
        to: "/auth/",
        search: { service_name: "accounts", redirect_url: "/account" },
      }).pathname,
    ).toBe("/auth/");
  });
});
