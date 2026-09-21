import { beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { AuditLogEntry } from "@/db/repositories/audit-log";
import { drained, partial } from "../../__tests__/live-runner";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { AuditLog } from "../../audit/ports";
import { BackgroundLive } from "../../background";
import { AuthApiError } from "../../errors";
import { authLayer, sessionOf } from "../../membership/__tests__/test-layers";
import { SentryLive } from "../../sentry";
import { signOutProgram } from "../auth-handler";

describe("signOutProgram", () => {
  const captured = recordSentryExceptions();
  const appended: AuditLogEntry[] = [];
  let signOutCalls = 0;
  beforeEach(() => {
    appended.length = 0;
    signOutCalls = 0;
  });

  const auditLayer = Layer.succeed(
    AuditLog,
    partial<AuditLog["Service"]>({
      appendAuditLog: (entry) =>
        Effect.sync(() => {
          appended.push(entry);
        }),
    }),
  );
  const signOut = () =>
    Effect.sync(() => {
      signOutCalls++;
    });
  const run = (getSession: Parameters<typeof authLayer>[0]) =>
    Effect.runPromise(
      drained(
        Effect.provide(
          signOutProgram({ sessionToken: "x" }),
          Layer.mergeAll(authLayer(getSession, signOut), auditLayer, BackgroundLive, SentryLive),
        ),
      ),
    );

  test("AC-011/012/013/014 better-auth 断は Sentry warning に記録し、audit 無しで sign-out を続行する", async () => {
    const cause = new Error("better-auth down");
    const before = captured.length;
    const result = await run(() => Effect.fail(new AuthApiError({ cause })));
    expect(result).toEqual({ success: true });
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[0]).toBe(cause);
    expect(captured.at(-1)?.[1]).toMatchObject({ level: "warning", tags: { handler: "signOut" } });
    expect(signOutCalls).toBe(1);
    expect(appended).toEqual([]);
  });

  test("AC-015 session 有りは sign_out を記帳し Sentry 0 件", async () => {
    const before = captured.length;
    await run(() => sessionOf("u1"));
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ eventType: "sign_out", userId: "u1" });
    expect(captured.length).toBe(before);
  });

  test("AC-016 session 無しは記帳も記録もしない", async () => {
    const before = captured.length;
    const result = await run(() => null);
    expect(result).toEqual({ success: true });
    expect(appended).toEqual([]);
    expect(captured.length).toBe(before);
  });
});
