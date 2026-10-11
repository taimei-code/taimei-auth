import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { AsyncResult, Atom, AtomRegistry, Reactivity } from "effect/reactivity";

import { failedBeforeAnyValue, refreshAndWait, waitForValue } from "../atom-runtime";

describe("refreshAndWait (notifyAfterRefresh に渡す refresh の契約)", () => {
  test("mount 済みの atom を取得し直し、新しい値で resolve する", async () => {
    let fetches = 0;
    const counter = Atom.make(Effect.sync(() => ++fetches));
    const registry = AtomRegistry.make();
    const unmount = registry.mount(counter);

    expect(await refreshAndWait(registry, counter)).toBe(2);
    expect(fetches).toBe(2);
    unmount();
  });

  test("取得し直しが失敗したら reject する", async () => {
    let fetches = 0;
    const failsOnRefresh = Atom.make(
      Effect.suspend(() =>
        ++fetches === 1 ? Effect.succeed(fetches) : Effect.fail("unavailable"),
      ),
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(failsOnRefresh);

    await expect(refreshAndWait(registry, failsOnRefresh)).rejects.toBe("unavailable");
    unmount();
  });
});

describe("waitForValue (reactivityKeys を付けた更新の後の取り直しを待つ)", () => {
  test("更新が返った直後に待つと、更新の前の値ではなく取り直した値で resolve する", async () => {
    let stored = "before";
    const runtime = Atom.runtime(Layer.empty);
    const list = runtime.factory.withReactivity(["list"])(
      runtime.atom(Effect.sleep("5 millis").pipe(Effect.map(() => stored))),
    );
    const update = runtime.fn((next: string) =>
      Reactivity.mutation(
        Effect.sync(() => {
          stored = next;
        }),
        ["list"],
      ),
    );
    const registry = AtomRegistry.make();
    const unmountList = registry.mount(list);
    const unmountUpdate = registry.mount(update);
    expect(await waitForValue(registry, list)).toBe("before");

    registry.set(update, "after");
    const exit = await Effect.runPromiseExit(
      AtomRegistry.getResult(registry, update, { suspendOnWaiting: true }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await waitForValue(registry, list)).toBe("after");
    unmountUpdate();
    unmountList();
  });
});

describe("failedBeforeAnyValue", () => {
  test("前回の成功値が無い失敗だけを、取得に失敗したと判定する", () => {
    const cause = Cause.fail("unavailable");

    expect(failedBeforeAnyValue(AsyncResult.failure(cause))).toBe(true);
    expect(
      failedBeforeAnyValue(
        AsyncResult.failure(cause, { previousSuccess: Option.some(AsyncResult.success(1)) }),
      ),
    ).toBe(false);
    expect(failedBeforeAnyValue(AsyncResult.initial())).toBe(false);
  });
});
