import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { DbError } from "../../errors";
import { SentryLive, type SentryService } from "../../sentry";
import { swallowAuditFailure } from "../report-failure";

// 代入だけでは Effect<number | undefined> も void に通るため、A を直接検査する (AC-019)。
const swallowed = swallowAuditFailure("sign_in")(Effect.succeed(1));
const _assignableToVoidNeverSentry: Effect.Effect<void, never, SentryService> = swallowed;
const _programValueDoesNotLeak: number extends Effect.Success<typeof swallowed> ? never : true =
  true;

describe("swallowAuditFailure", () => {
  const captured = recordSentryExceptions();
  const run = <A>(program: Effect.Effect<A, never, SentryService>) =>
    Effect.runPromise(Effect.exit(program).pipe(Effect.provide(SentryLive)));

  test("AC-020 成功時は値を捨てて undefined", async () => {
    const before = captured.length;
    const exit = await run(swallowAuditFailure("sign_in")(Effect.succeed(1)));
    expect(exit).toEqual(Exit.succeed(undefined));
    expect(captured.length).toBe(before);
  });

  test("AC-021/022 DbError は undefined に畳み、Sentry に level error + component / event で記録する", async () => {
    const cause = new Error("db down");
    const before = captured.length;
    const exit = await run(swallowAuditFailure("sign_in")(Effect.fail(new DbError({ cause }))));
    expect(exit).toEqual(Exit.succeed(undefined));
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[0]).toBe(cause);
    expect(captured.at(-1)?.[1]).toMatchObject({
      level: "error",
      tags: { component: "audit-log", event: "sign_in" },
    });
  });
});
