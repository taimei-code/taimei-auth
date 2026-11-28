import { expect, test } from "bun:test";
import type { MfaStateChangingEndpointsLackingChangeBudget } from "../mfa-contract";

const _everyChangingEndpointHasChangeBudget: [
  MfaStateChangingEndpointsLackingChangeBudget,
] extends [never]
  ? true
  : false = true;

test("MFA の群に .middleware の後から足した、状態を変える endpoint は、session ごとの試行枠を持たず型エラーになる (typecheck で検査する)", () => {
  expect(_everyChangingEndpointHasChangeBudget).toBe(true);
});
