import { describe, expect, test } from "bun:test";
import { Data, Effect, Schema } from "effect";

import { contractFailure, messageOnFailure, UndistinguishedFailure } from "../spa-contract-failure";

class Forbidden extends Data.TaggedError("Forbidden") {}
class LastOwner extends Data.TaggedError("LastOwner") {}
class HttpClientError extends Data.TaggedError("HttpClientError") {}
class SchemaError extends Data.TaggedError("SchemaError") {}

type Failure = Forbidden | LastOwner | HttpClientError | SchemaError;

const LeaveFailure = contractFailure(["LastOwner"]);

const failed = (failure: typeof LeaveFailure.Type) => ({ _tag: "Failed" as const, failure });

const leave = (call: Effect.Effect<"Left", Failure>) =>
  Effect.runPromise(
    call.pipe(
      messageOnFailure({
        failure: LeaveFailure,
        asUnexpected: ["Forbidden"],
        toMessage: failed,
      }),
    ),
  );

describe("SPA の API 契約の失敗を Message に写す", () => {
  test("成功した呼び出しの結果は、そのまま返る", async () => {
    expect(await leave(Effect.succeed("Left"))).toBe("Left");
  });

  test("区別する失敗は、同じ名前の失敗になる", async () => {
    expect(await leave(Effect.fail(new LastOwner()))).toEqual(failed("LastOwner"));
  });

  test("想定外に倒す失敗は、想定外の失敗になる", async () => {
    expect(await leave(Effect.fail(new Forbidden()))).toEqual(failed("Unexpected"));
  });

  test.each([
    ["通信の失敗", new HttpClientError()],
    ["応答の decode の失敗", new SchemaError()],
  ])("%s は、一覧に書かなくても想定外の失敗になる", async (_, failure) => {
    expect(await leave(Effect.fail(failure))).toEqual(failed("Unexpected"));
  });

  test("一覧に無い失敗は、Unexpected という名前でも失敗のまま残る", async () => {
    class Unexpected extends Data.TaggedError("Unexpected") {}
    const outcome = await Effect.runPromise(
      Effect.fail<LastOwner | Unexpected>(new Unexpected()).pipe(
        messageOnFailure({ failure: LeaveFailure, asUnexpected: [], toMessage: failed }),
        Effect.flip,
      ),
    );
    expect(outcome).toBeInstanceOf(Unexpected);
  });

  test("失敗を区別しない Command は、どの失敗も 1 つの Message になる", async () => {
    const hidden = { _tag: "Hidden" as const };
    const outcomes = await Promise.all(
      [new Forbidden(), new HttpClientError(), new SchemaError()].map((failure) =>
        Effect.runPromise(
          Effect.fail<Forbidden | HttpClientError | SchemaError>(failure).pipe(
            messageOnFailure({
              failure: UndistinguishedFailure,
              asUnexpected: ["Forbidden"],
              toMessage: () => hidden,
            }),
          ),
        ),
      ),
    );
    expect(outcomes).toEqual([hidden, hidden, hidden]);
  });

  test("Message に載せる失敗の schema は、区別する失敗と想定外を受け付け、想定外に倒す失敗の名前を受け付けない", () => {
    const isLeaveFailure = Schema.is(LeaveFailure);
    expect(["LastOwner", "Unexpected", "Forbidden"].map(isLeaveFailure)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
