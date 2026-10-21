import { describe, expect, mock, test } from "bun:test";
import { Exit } from "effect";

import { oneAtATime } from "../one-at-a-time";

describe("送信の処理を同時に 1 つだけ走らせる", () => {
  test("1 回目の処理が終わる前の 2 回目の呼び出しは、処理を走らせずに false を返す", () => {
    const run = mock(() => new Promise<void>(() => {}));
    const runOneAtATime = oneAtATime();

    expect(runOneAtATime(run)).toBe(true);
    expect(runOneAtATime(run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("1 回目の処理が成功の Exit でも失敗の Exit でも、終わった後の呼び出しは処理を走らせて true を返す", async () => {
    const runOneAtATime = oneAtATime();
    for (const exit of [Exit.succeed("ok"), Exit.fail("rejected")]) {
      const settled = Promise.resolve(exit);
      runOneAtATime(() => settled);
      await settled;
      await Promise.resolve();

      const run = mock(() => Promise.resolve(exit));
      expect(runOneAtATime(run)).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
      await run.mock.results[0]?.value;
      await Promise.resolve();
    }
  });

  test("処理が promise を返す前に同期で throw しても、次の呼び出しは処理を走らせる", () => {
    const runOneAtATime = oneAtATime();
    expect(() =>
      runOneAtATime(() => {
        throw new Error("sync");
      }),
    ).toThrow("sync");

    const run = mock(() => new Promise<void>(() => {}));
    expect(runOneAtATime(run)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
