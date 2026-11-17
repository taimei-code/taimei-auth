import { expect, test } from "bun:test";
import type { PasskeyEndpointsLackingSessionBudget } from "../passkey-contract";

const _everyEndpointHasSessionBudget: [PasskeyEndpointsLackingSessionBudget] extends [never]
  ? true
  : false = true;

test("パスキーの群に .middleware の後から足した endpoint は、ログインと session ごとの試行枠を持たず型エラーになる (typecheck で検査する)", () => {
  expect(_everyEndpointHasSessionBudget).toBe(true);
});
