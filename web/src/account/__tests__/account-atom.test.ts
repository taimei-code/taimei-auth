import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";

import { AuthClientReadFailed, readAuthClient } from "../account-atom";

describe("better-auth の client の読み出しは失敗を失敗として返す", () => {
  test("error を返すと、その status の AuthClientReadFailed で失敗する (client は失敗を throw せず error で返す)", async () => {
    const exit = await Effect.runPromiseExit(
      readAuthClient(async () => ({ data: null, error: { status: 401 } })),
    );

    expect(exit).toEqual(Exit.fail(new AuthClientReadFailed({ status: 401 })));
  });

  test("通信が reject すると defect になり、AuthClientReadFailed にはならない", async () => {
    const exit = await Effect.runPromiseExit(
      readAuthClient(async () => {
        throw new Error("network");
      }),
    );

    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(false);
  });

  test("data を返すとその値で成功する", async () => {
    expect(
      await Effect.runPromise(readAuthClient(async () => ({ data: [1, 2], error: null }))),
    ).toEqual([1, 2]);
  });
});
