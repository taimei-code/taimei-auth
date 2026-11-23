import { beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { drained, partial } from "../../__tests__/live-runner";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { type Background, BackgroundLive } from "../../background";
import { EmailSender } from "../../email/ports";
import { EmailError } from "../../errors";
import { SentryLive, type SentryService } from "../../sentry";
import {
  notifyMfaDisabled,
  notifyMfaDisabledForManagement,
  notifyMfaEnabled,
} from "../notification-adapter";

const senderEndingWith = (outcome: Effect.Effect<void, EmailError>) =>
  Layer.succeed(
    EmailSender,
    partial<EmailSender["Service"]>({
      sendMfaEnabled: () => outcome,
      sendMfaDisabled: () => outcome,
    }),
  );

const runWith = (
  sender: Layer.Layer<EmailSender>,
  program: Effect.Effect<void, never, EmailSender | Background | SentryService>,
) =>
  Effect.runPromise(
    drained(Effect.provide(program, Layer.mergeAll(sender, BackgroundLive, SentryLive))),
  );

describe("MFA 通知メールの失敗", () => {
  const { exceptions: captured } = recordSentry();
  const cause = new Error("resend down");
  const failingSender = senderEndingWith(Effect.fail(new EmailError({ cause })));
  const run = (program: Effect.Effect<void, never, EmailSender | Background | SentryService>) =>
    runWith(failingSender, program);

  test("有効化通知の送信失敗は通知を落とさず Sentry warning に残る", async () => {
    const before = captured.length;
    await run(notifyMfaEnabled("u@example.com"));
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[0]).toBe(cause);
    expect(captured.at(-1)?.[1]).toMatchObject({
      level: "warning",
      tags: { component: "mfa-notification" },
    });
  });

  test("無効化通知の送信失敗も同じ経路で Sentry に残る", async () => {
    const before = captured.length;
    await run(notifyMfaDisabled("u@example.com"));
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("mfa-notification");
  });

  test("management 向けの同期通知は false に倒し Sentry に残る", async () => {
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

describe("MFA 通知メールの送信が型の無い例外で落ちた時", () => {
  const sentry = recordSentry();
  beforeEach(sentry.reset);
  const defect = new Error("通知メールの組み立てで例外");
  const dyingSender = senderEndingWith(Effect.die(defect));
  const deliveringSender = senderEndingWith(Effect.void);
  const run = runWith;

  test("有効化通知の送信が落ちても、操作は成功し、Sentry に warning が 1 件残る", async () => {
    await run(dyingSender, notifyMfaEnabled("u@example.com"));

    expect(sentry.warnings()).toHaveLength(1);
  });

  test("無効化通知の送信が落ちても、操作は成功し、Sentry に warning が 1 件残る", async () => {
    await run(dyingSender, notifyMfaDisabled("u@example.com"));

    expect(sentry.warnings()).toHaveLength(1);
  });

  test("management 向けの同期通知の送信が落ちても、通知できなかったことを false で返し、Sentry に warning が 1 件残る", async () => {
    const notified = await Effect.runPromise(
      Effect.provide(
        notifyMfaDisabledForManagement("u@example.com"),
        Layer.mergeAll(dyingSender, SentryLive),
      ),
    );

    expect(notified).toBe(false);
    expect(sentry.warnings()).toHaveLength(1);
  });

  test("送信が成功した通知は、Sentry に何も残さない", async () => {
    await run(deliveringSender, notifyMfaEnabled("u@example.com"));
    await run(deliveringSender, notifyMfaDisabled("u@example.com"));

    expect(sentry.exceptions).toEqual([]);
    expect(sentry.messages).toEqual([]);
  });
});
