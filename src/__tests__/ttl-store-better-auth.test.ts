import { describe, expect, test } from "bun:test";
import { ManagedRuntime } from "effect";
import { TtlStoreError } from "../errors";
import type { TtlStoreBackend } from "../ttl-store";
import { betterAuthStorage } from "../ttl-store-better-auth";
import { ttlStoreLayer } from "../ttl-store-service";
import { MemoryKvStore } from "../kv-store.memory";
import { memoryBackend } from "../ttl-store";
import { betterAuthKeyOf } from "./test-ttl-store";

type Call = { method: string; args: unknown[] };

const recordingBackend = (overrides: Partial<TtlStoreBackend> = {}) => {
  const calls: Call[] = [];
  const memory = memoryBackend(new MemoryKvStore());
  const record =
    <A extends unknown[], R>(method: string, run: (...args: A) => Promise<R>) =>
    (...args: A) => {
      calls.push({ method, args });
      return run(...args);
    };
  const backend: TtlStoreBackend = {
    ...memory,
    get: record("get", memory.get),
    set: record("set", memory.set),
    delete: record("delete", memory.delete),
    getAndDelete: record("getAndDelete", memory.getAndDelete),
    mergeSessionIndex: record("mergeSessionIndex", memory.mergeSessionIndex),
    incrementRateWindow: record("incrementRateWindow", memory.incrementRateWindow),
    ...overrides,
  };
  return { backend, calls };
};

const storageOver = (backend: TtlStoreBackend) =>
  betterAuthStorage(ManagedRuntime.make(ttlStoreLayer(backend)));

const SESSION_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

describe("better-auth の TTL store の入口", () => {
  test("better-auth が知らない形の key への書き込みは、backend に触れずに拒む", async () => {
    const { backend, calls } = recordingBackend();

    await expect(storageOver(backend).set("rate-limit:x", "1")).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test("better-auth の rate limit は使わないので、increment は backend に触れずに拒む", async () => {
    const { backend, calls } = recordingBackend();

    await expect(
      Promise.resolve(storageOver(backend).increment(SESSION_TOKEN, 60)),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test("利用者が送った値が知らない形の key になる読み取りと削除は、backend に触れずに「無い」と答える (revoke-session は body の token で session を探す)", async () => {
    const { backend, calls } = recordingBackend();
    const storage = storageOver(backend);

    expect(await storage.get("rate-limit:x")).toBeNull();
    expect(await storage.getAndDelete?.("rate-limit:x")).toBeNull();
    expect(await storage.delete("rate-limit:x")).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("backend の失敗は TtlStoreError として better-auth に返る", async () => {
    const { backend } = recordingBackend({
      get: async () => {
        throw new Error("backend down");
      },
    });

    const rejection = await Promise.resolve(storageOver(backend).get(SESSION_TOKEN)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(TtlStoreError);
  });

  test("backend が応答しない時は、TTL store の timeout で失敗し、better-auth を待たせ続けない", async () => {
    const { backend } = recordingBackend({
      getAndDelete: () => new Promise<string | null>(() => {}),
    });

    const rejection = await Promise.resolve(
      storageOver(backend).getAndDelete?.(SESSION_TOKEN),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(TtlStoreError);
  }, 5_000);

  test("利用者ごとの session の一覧は、同じ一覧を読んだ 2 つの作成が順に書いても、両方の session を残す", async () => {
    const store = new MemoryKvStore();
    const storage = storageOver(memoryBackend(store));
    const later = (seconds: number) => Date.now() + seconds * 1000;
    const listKey = "active-sessions-user-1";
    await storage.set(listKey, JSON.stringify([{ token: "s0", expiresAt: later(60) }]), 60);

    await storage.set(
      listKey,
      JSON.stringify([
        { token: "s0", expiresAt: later(60) },
        { token: "s1", expiresAt: later(120) },
      ]),
      120,
    );
    await storage.set(
      listKey,
      JSON.stringify([
        { token: "s0", expiresAt: later(60) },
        { token: "s2", expiresAt: later(90) },
      ]),
      90,
    );

    const tokens = (JSON.parse(store.get(betterAuthKeyOf(listKey)) ?? "[]") as { token: string }[])
      .map(({ token }) => token)
      .sort();
    expect(tokens).toEqual(["s0", "s1", "s2"]);
  });

  test("session の一覧でない key への書き込みは、合わせずにそのまま書く", async () => {
    const { backend, calls } = recordingBackend();
    const storage = storageOver(backend);

    await storage.set("verification:abc", "v", 60);
    await storage.set(SESSION_TOKEN, "s", 60);

    expect(calls.map(({ method }) => method)).toEqual(["set", "set"]);
  });
});
