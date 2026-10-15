import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { AsyncResult, Atom, AtomRegistry, Reactivity } from "effect/reactivity";

import {
  failedBeforeAnyValue,
  readResult,
  refreshAndWait,
  runMutation,
  waitForValue,
} from "../atom-runtime";

describe("refreshAndWait (MFA の有効化の後だけが使う。取り直すと有効化済みの表示に替わってリカバリーコードの dialog が外れるので、コードを閉じるまで取り直しを遅らせる)", () => {
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

describe("runMutation (loader から更新を 1 回実行する)", () => {
  test("引数を渡して実行し、結果を Exit で返す", async () => {
    const runtime = Atom.runtime(Layer.empty);
    const double = runtime.fn((n: number) => Effect.succeed(n * 2));

    const exit = await runMutation(AtomRegistry.make(), double, 21);

    expect(exit).toEqual(Exit.succeed(42));
  });

  test("実行中の atom をもう一度呼ぶと前の呼び出しは中断され、後の結果で解決する (共有の atom は pending の間は呼ばせない)", async () => {
    let firstInterrupted = false;
    const runtime = Atom.runtime(Layer.empty);
    const slowFirst = runtime.fn((n: number) =>
      n === 1
        ? Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => (firstInterrupted = true))))
        : Effect.succeed(n),
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(slowFirst);

    const first = runMutation(registry, slowFirst, 1);
    const second = runMutation(registry, slowFirst, 2);

    expect(await Promise.all([first, second])).toEqual([Exit.succeed(2), Exit.succeed(2)]);
    expect(firstInterrupted).toBe(true);
    unmount();
  });
});

describe("readResult (route の beforeLoad / loader で atom を読む)", () => {
  test("遷移の取り消しで abort されたら、取得を待たずに中断の Exit を返す", async () => {
    const never = Atom.make(Effect.never);
    const controller = new AbortController();

    const pending = readResult(AtomRegistry.make(), never, controller.signal);
    controller.abort();

    expect(Exit.hasInterrupts(await pending)).toBe(true);
  });
});
