import { describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { unreachableReason, withSpy } from "./live-runner";

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

describe("DB に繋がらない時の原因は、cause を辿って最初の code を出す", () => {
  test("drizzle と pg が包んだ失敗から、接続の失敗の code を取り出す", () => {
    const refused = Object.assign(new AggregateError([]), { code: "ECONNREFUSED" });
    expect(unreachableReason(new Error("Failed query", { cause: refused }))).toBe("ECONNREFUSED");
  });

  test("code が文字列でなければ、さらに cause を辿る", () => {
    const refused = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    const wrapper = Object.assign(new Error("wrapper", { cause: refused }), { code: undefined });
    expect(unreachableReason(wrapper)).toBe("ECONNREFUSED");
  });

  test("code も cause も無ければ、失敗そのものを文字列にする", () => {
    expect(unreachableReason(new Error("boom"))).toBe("Error: boom");
  });
});
