import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { AtomRegistry } from "effect/reactivity";

import { atomRuntime, refreshAndWait } from "../atom-runtime";
import { fromRequestJson, getJson, RequestJsonError } from "../request-json";
import { restoreFetch } from "./fetch-stub";

afterEach(restoreFetch);

const stateAtom = atomRuntime.atom(fromRequestJson(() => getJson<{ n: number }>("/api/state")));

describe("refreshAndWait (notifyAfterRefresh に渡す refresh の契約)", () => {
  test("mount 済みの atom を取得し直し、新しい値で resolve する", async () => {
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ n: 1 }))
      .mockResolvedValueOnce(Response.json({ n: 2 }));
    const registry = AtomRegistry.make();
    const unmount = registry.mount(stateAtom);

    expect(await refreshAndWait(registry, stateAtom)).toEqual({ n: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    unmount();
  });

  test("再取得が失敗したら status を保った error で reject する", async () => {
    spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ n: 1 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const registry = AtomRegistry.make();
    const unmount = registry.mount(stateAtom);

    const rejection = refreshAndWait(registry, stateAtom);
    await expect(rejection).rejects.toBeInstanceOf(RequestJsonError);
    await expect(rejection).rejects.toMatchObject({ status: 503 });
    unmount();
  });
});
