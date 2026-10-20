import { expect, test } from "bun:test";
import { Effect } from "effect";
import { LastOwner } from "../../membership/errors";
import { NotFound } from "../../failures";
import type { RouteEffect } from "../run-route";

const _declared: RouteEffect<Response> = Effect.fail(new NotFound());
// @ts-expect-error SPA の契約の失敗は SPA の外の adapter に渡せない
const _undeclared: RouteEffect<Response> = Effect.fail(new LastOwner());

test("RouteError の外の失敗を runRoute に渡すと型エラーになる (typecheck で検査する)", () => {
  expect(true).toBe(true);
});
