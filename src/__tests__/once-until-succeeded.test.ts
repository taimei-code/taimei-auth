import { describe, expect, test } from "bun:test";
import { onceUntilSucceeded } from "../once-until-succeeded";

const countedRun = (outcomes: ("succeed" | "fail")[]) => {
  const calls = { count: 0 };
  const run = async () => {
    const outcome = outcomes[calls.count] ?? "succeed";
    calls.count += 1;
    if (outcome === "fail") throw new Error(`run ${calls.count} failed`);
  };
  return { calls, run };
};

describe("onceUntilSucceeded は、run が成功するまでの呼び出しを 1 本にまとめる", () => {
  test("同時に呼んだ呼び手は 1 回の run を共有する", async () => {
    const { calls, run } = countedRun(["succeed"]);
    const once = onceUntilSucceeded(run);

    const results = await Promise.all(Array.from({ length: 10 }, () => once()));

    expect(calls.count).toBe(1);
    expect(results).toEqual(Array.from({ length: 10 }, () => undefined));
  });

  test("成功した後は run を呼び直さない", async () => {
    const { calls, run } = countedRun(["succeed"]);
    const once = onceUntilSucceeded(run);

    await once();
    await once();

    expect(calls.count).toBe(1);
  });

  test("失敗した呼び出しは失敗を返し、次の呼び出しで run をやり直す", async () => {
    const { calls, run } = countedRun(["fail", "succeed"]);
    const once = onceUntilSucceeded(run);

    await expect(once()).rejects.toThrow("run 1 failed");
    await once();

    expect(calls.count).toBe(2);
  });

  test("同時に呼んだ呼び手は、共有した run の失敗をすべて受ける", async () => {
    const { calls, run } = countedRun(["fail"]);
    const once = onceUntilSucceeded(run);

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => once()));

    expect(calls.count).toBe(1);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
  });
});
