import { describe, expect, test } from "bun:test";
import { auth } from "../auth";
import { MemoryKvStore } from "../kv-store.memory";
import { memoryBackend } from "../ttl-store";

describe("TTL store の getAndDelete は値を 1 回だけ渡す", () => {
  test("同じ鍵に同時に 2 回呼ぶと、値を返すのは 1 回だけ (DO の adapter は input gate に頼るので、本番の実装は QA-MR-05 で確かめる)", async () => {
    const backend = memoryBackend(new MemoryKvStore());
    await backend.set("verification:token", "value", 60);

    const results = await Promise.all([
      backend.getAndDelete("verification:token"),
      backend.getAndDelete("verification:token"),
    ]);

    expect(results.filter((value) => value === "value")).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);
  });

  test("better-auth に渡す TTL store は getAndDelete を持つ (無いと better-auth は get と delete に分けて消費し、確認用の値を 2 回使われ得る)", () => {
    expect(typeof auth.options.secondaryStorage?.getAndDelete).toBe("function");
  });
});
