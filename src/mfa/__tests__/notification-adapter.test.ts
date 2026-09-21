import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { drained, partial } from "../../__tests__/live-runner";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { type Background, BackgroundLive } from "../../background";
import { EmailSender } from "../../email/ports";
import { EmailError } from "../../errors";
import { SentryLive, type SentryService } from "../../sentry";
import {
  notifyMfaDisabled,
  notifyMfaDisabledForManagement,
  notifyMfaEnabled,
} from "../notification-adapter";

describe("MFA 通知メールの失敗", () => {
  const captured = recordSentryExceptions();
  const cause = new Error("resend down");
  const failingSender = Layer.succeed(
    EmailSender,
    partial<EmailSender["Service"]>({
      sendMfaEnabled: () => Effect.fail(new EmailError({ cause })),
      sendMfaDisabled: () => Effect.fail(new EmailError({ cause })),
    }),
  );
  const run = (program: Effect.Effect<void, never, EmailSender | Background | SentryService>) =>
    Effect.runPromise(
      drained(Effect.provide(program, Layer.mergeAll(failingSender, BackgroundLive, SentryLive))),
    );

  test("AC-034 有効化通知の送信失敗は通知を落とさず Sentry warning に残る", async () => {
    const before = captured.length;
    await run(notifyMfaEnabled("u@example.com"));
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[0]).toBe(cause);
    expect(captured.at(-1)?.[1]).toMatchObject({
      level: "warning",
      tags: { component: "mfa-notification" },
    });
  });

  test("AC-035 無効化通知の送信失敗も同じ経路で Sentry に残る", async () => {
    const before = captured.length;
    await run(notifyMfaDisabled("u@example.com"));
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("mfa-notification");
  });

  test("AC-036 management 向けの同期通知は false に倒し Sentry に残る", async () => {
    const before = captured.length;
    const notified = await Effect.runPromise(
      Effect.provide(
        notifyMfaDisabledForManagement("u@example.com"),
        Layer.mergeAll(failingSender, SentryLive),
      ),
    );
    expect(notified).toBe(false);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("mfa-notification");
  });
});
