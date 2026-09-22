import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AuthApiError, DbError, TtlStoreError, tryAuthApi, tryDb, tryTtlStore } from "../errors";

// 境界のエラー (design §3.6) のテスト。サードパーティ由来の失敗を、cause: unknown を付けて E channel の値にする。
describe("boundary errors", () => {
  test("DbError は _tag と cause を own property に持ち、cause の identity を保つ", () => {
    const cause = new Error("db timeout");
    const e = new DbError({ cause });
    expect(Object.hasOwn(e, "_tag")).toBe(true);
    expect(e._tag).toBe("DbError");
    expect(e.cause).toBe(cause);
  });
});

describe("tryDb / tryAuthApi (Promise → boundary error)", () => {
  test("resolve した Promise は値を返す", async () => {
    expect(await Effect.runPromise(tryDb(() => Promise.resolve(42)))).toBe(42);
  });

  test("reject した Promise は DbError に包まれ cause の identity を保つ", async () => {
    const boom = new Error("db timeout");
    const e = await Effect.runPromise(Effect.flip(tryDb(() => Promise.reject(boom))));
    expect(e).toBeInstanceOf(DbError);
    expect(e.cause).toBe(boom);
  });

  test("同期 throw も DbError に包まれる (fail-open にならない)", async () => {
    const boom = new Error("sync");
    const e = await Effect.runPromise(
      Effect.flip(
        tryDb(() => {
          throw boom;
        }),
      ),
    );
    expect(e.cause).toBe(boom);
  });

  test("tryTtlStore は TtlStoreError に包む", async () => {
    const boom = new Error("upstash 1016");
    const e = await Effect.runPromise(Effect.flip(tryTtlStore(() => Promise.reject(boom))));
    expect(e).toBeInstanceOf(TtlStoreError);
    expect(e.cause).toBe(boom);
  });

  test("tryAuthApi は AuthApiError に包む", async () => {
    const boom = new Error("auth");
    const e = await Effect.runPromise(Effect.flip(tryAuthApi(() => Promise.reject(boom))));
    expect(e).toBeInstanceOf(AuthApiError);
    expect(e.cause).toBe(boom);
  });
});
