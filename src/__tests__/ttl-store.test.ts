import { describe, expect, test } from "bun:test";
import { durableObjectBackend, type KvStoreNamespace } from "../ttl-store";
import { betterAuthKeyOf } from "./test-ttl-store";

describe("Durable Object の TTL store", () => {
  test("session の一覧の合わせ込みは、key の名前の Durable Object の中で行う (1 つの呼び出しの中で読んで書く)", async () => {
    const calls: unknown[][] = [];
    const namespace = {
      getByName: (name: string) => ({
        mergeSessionIndex: async (value: string) => {
          calls.push([name, value]);
        },
      }),
    } as unknown as KvStoreNamespace;

    await durableObjectBackend(namespace).mergeSessionIndex(
      betterAuthKeyOf("active-sessions-user-1"),
      "[]",
    );

    expect(calls).toEqual([["active-sessions-user-1", "[]"]]);
  });
});
