import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { SentryLive, SentryService } from "../sentry";
import { recordSentry } from "./sentry-recorder";

describe("recordSentry", () => {
  const sentry = recordSentry();

  test("例外と message を別々の一覧に 1 件ずつ記録する", async () => {
    const error = new Error("boom");
    await Effect.runPromise(
      SentryService.use((service) =>
        Effect.andThen(
          service.captureException(error, { level: "warning" }),
          service.captureMessage("hello", { level: "info" }),
        ),
      ).pipe(Effect.provide(SentryLive)),
    );

    expect(sentry.exceptions).toEqual([[error, { level: "warning" }]]);
    expect(sentry.messages).toEqual([{ message: "hello", context: { level: "info" } }]);
  });
});
