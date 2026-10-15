import { describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { withSpy } from "./live-runner";

describe("withSpy は restore の前に呼び出しを読ませる", () => {
  test("Bun の mockRestore は mock.calls も空にする", () => {
    const target = { greet: (name: string) => `hello ${name}` };
    const spy = spyOn(target, "greet");
    target.greet("a");
    expect(spy.mock.calls).toHaveLength(1);

    spy.mockRestore();

    expect(spy.mock.calls).toHaveLength(0);
  });

  test("withSpy の use の中では呼び出しを読め、終わると元の関数に戻る", async () => {
    const target = { greet: (name: string) => `hello ${name}` };
    const original = target.greet;

    const calls = await Effect.runPromise(
      withSpy(
        () => spyOn(target, "greet"),
        (spy) =>
          Effect.sync(() => {
            target.greet("a");
            return spy.mock.calls.length;
          }),
      ),
    );

    expect(calls).toBe(1);
    expect(target.greet).toBe(original);
  });
});
