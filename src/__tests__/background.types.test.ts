import { expect, test } from "bun:test";
import { Effect } from "effect";

import { Background } from "../background";

const _runsInfallibleEffect = Effect.gen(function* () {
  const background = yield* Background;
  yield* background.run(Effect.succeed(1));
});

const _runsFailingEffect = Effect.gen(function* () {
  const background = yield* Background;
  // @ts-expect-error 失敗し得る effect は、切り離して走らせる Background.run に渡せない
  yield* background.run(Effect.fail("boom" as const));
});

test("Background.run が失敗し得る effect を受けないことは typecheck で落ちる (runtime の検証は無い)", () => {
  expect(true).toBe(true);
});
