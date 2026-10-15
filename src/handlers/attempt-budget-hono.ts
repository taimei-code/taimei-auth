import { Effect } from "effect";
import type { Context, MiddlewareHandler } from "hono";
import { type AttemptBudget, spendAttemptBudgetOrRateLimited } from "../attempt-budget";
import { CONTINUE, runMiddleware } from "./run-route";

export const attemptBudgetProgram = (budget: AttemptBudget<"allow">, subject: string) =>
  spendAttemptBudgetOrRateLimited(budget, subject).pipe(Effect.as(CONTINUE));

export const attemptBudgetMiddleware =
  (
    budget: AttemptBudget<"allow">,
    subjectOf: (c: Context) => string | Promise<string>,
  ): MiddlewareHandler =>
  (c, next) =>
    runMiddleware(
      c,
      next,
      Effect.promise(async () => subjectOf(c)).pipe(
        Effect.flatMap((subject) => attemptBudgetProgram(budget, subject)),
      ),
    );
