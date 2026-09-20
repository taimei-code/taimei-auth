import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { MemoryKvStore } from "../kv-store.memory";

const T0 = new Date("2026-09-20T00:00:00Z");
const at = (offsetMs: number) => setSystemTime(new Date(T0.getTime() + offsetMs));

describe("MemoryKvStore (KvStore DO と同じ 1 entry モデル)", () => {
  let store: MemoryKvStore;
  beforeEach(() => {
    at(0);
    store = new MemoryKvStore();
  });
  afterEach(() => setSystemTime());

  test("TTL 0 は即期限切れで get が null", () => {
    store.set("k", "v", 0);
    expect(store.get("k")).toBeNull();
  });

  test("TTL 省略は無期限", () => {
    store.set("k", "v");
    at(10 * 60 * 1000);
    expect(store.get("k")).toBe("v");
    expect(store.ttl("k")).toBe(-1);
  });

  test("TTL 1 秒は 999ms では残り 1000ms で null", () => {
    store.set("k", "v", 1);
    at(999);
    expect(store.get("k")).toBe("v");
    expect(store.ttl("k")).toBe(1);
    at(1000);
    expect(store.get("k")).toBeNull();
    expect(store.ttl("k")).toBe(-2);
  });

  test("incrementWindow は 1,2,3 と増え window 経過で 1 に戻る", () => {
    expect(store.incrementWindow("w", 2)).toBe(1);
    expect(store.incrementWindow("w", 2)).toBe(2);
    at(1500);
    expect(store.incrementWindow("w", 2)).toBe(3);
    at(1500 + 2000);
    expect(store.incrementWindow("w", 2)).toBe(1);
  });

  test("getAndDelete は 1 回だけ値を返す", () => {
    store.set("once", "token", 60);
    expect(store.getAndDelete("once")).toBe("token");
    expect(store.getAndDelete("once")).toBeNull();
  });

  test("keys(prefix) は期限切れを除いて prefix 一致を返す", () => {
    store.set("p:a", "1", 60);
    store.set("p:b", "2", 1);
    store.set("q:c", "3", 60);
    at(1000);
    expect(store.keys("p:").sort()).toEqual(["p:a"]);
  });
});
