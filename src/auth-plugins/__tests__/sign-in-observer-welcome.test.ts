import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { drained, partial } from "../../__tests__/live-runner";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { AuditLog } from "../../audit/ports";
import { BackgroundLive } from "../../background";
import { EmailSender } from "../../email/ports";
import { EmailError } from "../../errors";
import { SentryLive } from "../../sentry";
import { observeSignInProgram } from "../sign-in-observer";

describe("welcome メールの送信失敗", () => {
  const captured = recordSentryExceptions();
  const cause = new Error("resend down");
  const layers = Layer.mergeAll(
    Layer.succeed(
      EmailSender,
      partial<EmailSender["Service"]>({
        sendWelcome: () => Effect.fail(new EmailError({ cause })),
      }),
    ),
    Layer.succeed(AuditLog, partial<AuditLog["Service"]>({ appendAuditLog: () => Effect.void })),
    BackgroundLive,
    SentryLive,
  );

  test("AC-037 新規 user への welcome 送信失敗は sign_in 観測を落とさず Sentry warning に残る", async () => {
    const before = captured.length;
    await Effect.runPromise(
      drained(
        Effect.provide(
          observeSignInProgram({
            user: { id: "u1", email: "u1@example.com", name: "U", createdAt: new Date() },
            route: { _tag: "Mapped", method: "magic_link" },
            headers: null,
          }),
          layers,
        ),
      ),
    );
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[0]).toBe(cause);
    expect(captured.at(-1)?.[1]).toMatchObject({
      level: "warning",
      tags: { component: "welcome-email" },
    });
  });
});
