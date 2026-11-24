import { expect, test } from "bun:test";
import { Data, Effect } from "effect";

import { contractFailure, messageOnFailure } from "../spa-contract-failure";

class Forbidden extends Data.TaggedError("Forbidden") {}
class LastOwner extends Data.TaggedError("LastOwner") {}
class HttpClientError extends Data.TaggedError("HttpClientError") {}

const call: Effect.Effect<"Left", Forbidden | LastOwner | HttpClientError> = Effect.succeed("Left");

const toMessage = (failure: string) => ({ _tag: "Failed" as const, failure });

const settlingEveryDeclaredFailure: Effect.Effect<unknown> = call.pipe(
  messageOnFailure({
    failure: contractFailure(["LastOwner"]),
    asUnexpected: ["Forbidden"],
    toMessage,
  }),
);

// @ts-expect-error 宣言した失敗 (Forbidden) を一覧に書き忘れると、失敗が残って Command の effect にできない
const forgettingADeclaredFailure: Effect.Effect<unknown> = call.pipe(
  messageOnFailure({
    failure: contractFailure(["LastOwner"]),
    asUnexpected: [],
    toMessage,
  }),
);

const distinguishingAnUndeclaredFailure = call.pipe(
  // @ts-expect-error 契約に無い失敗 (NotFound) は、区別する失敗の一覧に書けない
  messageOnFailure({
    failure: contractFailure(["LastOwner", "NotFound"]),
    asUnexpected: ["Forbidden"],
    toMessage,
  }),
);

const foldingAnUndeclaredFailure = call.pipe(
  // @ts-expect-error 契約に無い失敗 (NotFound) は、想定外に倒す失敗の一覧に書けない
  messageOnFailure({
    failure: contractFailure(["LastOwner"]),
    asUnexpected: ["Forbidden", "NotFound"],
    toMessage,
  }),
);

const listingAFailureTwice = call.pipe(
  messageOnFailure({
    failure: contractFailure(["LastOwner", "Forbidden"]),
    // @ts-expect-error 区別する失敗 (Forbidden) を、想定外に倒す失敗の一覧にも書けない
    asUnexpected: ["Forbidden"],
    toMessage,
  }),
);

const listingATransportFailure = call.pipe(
  messageOnFailure({
    failure: contractFailure(["LastOwner"]),
    // @ts-expect-error 通信の失敗 (HttpClientError) は module が想定外に倒すので、一覧に書けない
    asUnexpected: ["Forbidden", "HttpClientError"],
    toMessage,
  }),
);

test("失敗の一覧と呼び出しの失敗の食い違いは typecheck で落ちる (runtime の検証は無い)", () => {
  expect([
    settlingEveryDeclaredFailure,
    forgettingADeclaredFailure,
    distinguishingAnUndeclaredFailure,
    foldingAnUndeclaredFailure,
    listingAFailureTwice,
    listingATransportFailure,
  ]).toHaveLength(6);
});
