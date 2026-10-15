import { expect, test } from "bun:test";
import {
  ATTEMPT_BUDGETS,
  spendAttemptBudgetFailClosed,
  spendAttemptBudgetFailOpen,
} from "../attempt-budget";

const _passesWhenUncountable = () =>
  // @ts-expect-error 数えられない時に拒否する試行枠を、通す関数に渡せない
  spendAttemptBudgetFailOpen(ATTEMPT_BUDGETS.mfaDisablePerUser, "user-1");

const _deniesWhenUncountable = () =>
  // @ts-expect-error 数えられない時に通す試行枠を、拒否する関数に渡せない
  spendAttemptBudgetFailClosed(ATTEMPT_BUDGETS.magicLinkPerIp, "203.0.113.1");

test("試行枠の宣言と、数えられない時の扱いを選ぶ関数の食い違いは typecheck で落ちる (runtime の検証は無い)", () => {
  expect(true).toBe(true);
});
