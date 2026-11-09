import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { boot } from "../boot";
import { MemoryKvStore } from "../kv-store.memory";
import { getRuntime, initRuntime } from "../runtime";
import { memoryBackend } from "../ttl-store";
import { testTtlStore } from "./test-ttl-store";

describe("getRuntime", () => {
  test("2 回呼ぶと同一 object を返す (memo)", () => {
    expect(getRuntime()).toBe(getRuntime());
  });

  test("boot 後に initRuntime を呼んでも最初の runtime を返す (テストが Bun の entry を import しても preload の結線が残る)", () => {
    const booted = getRuntime();
    expect(initRuntime(testTtlStore)).toBe(booted);
  });

  test("boot を別の TTL store で 2 回目に呼ぶと、黙って最初の結線を使わずに throw する", () => {
    expect(() => boot(memoryBackend(new MemoryKvStore()))).toThrow("別の TTL store");
  });

  test("boot を同じ TTL store で 2 回目に呼ぶと、最初の runtime を返す", () => {
    expect(boot(testTtlStore)).toBe(getRuntime());
  });

  test("Effect を実行できる", async () => {
    expect(await getRuntime().runPromise(Effect.succeed(1))).toBe(1);
  });
});
