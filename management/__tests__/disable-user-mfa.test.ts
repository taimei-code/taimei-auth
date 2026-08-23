import { describe, expect, test } from "bun:test";
import { toDisableUserMfaReport } from "../disable-user-mfa";

describe("toDisableUserMfaReport", () => {
  test("changed success is stdout with notified", () => {
    expect(toDisableUserMfaReport("user-1", { ok: true, changed: true, notified: true })).toEqual({
      stream: "stdout",
      exitCode: 0,
      body: { userId: "user-1", changed: true, notified: true },
    });
  });

  test("idempotent success keeps the existing reason key", () => {
    expect(toDisableUserMfaReport("user-1", { ok: true, changed: false })).toEqual({
      stream: "stdout",
      exitCode: 0,
      body: { userId: "user-1", changed: false, reason: "mfa_not_enabled" },
    });
  });

  test("not_found is stderr with the canonical error", () => {
    expect(
      toDisableUserMfaReport("user-1", { ok: false, error: "not_found", status: 404 }),
    ).toEqual({
      stream: "stderr",
      exitCode: 1,
      body: { userId: "user-1", error: "not_found" },
    });
  });

  test("busy adds retryAfterSeconds without changing existing keys", () => {
    expect(
      toDisableUserMfaReport("user-1", {
        ok: false,
        error: "temporarily_unavailable",
        status: 503,
        retryAfterSeconds: 10,
      }),
    ).toEqual({
      stream: "stderr",
      exitCode: 1,
      body: { userId: "user-1", error: "temporarily_unavailable", retryAfterSeconds: 10 },
    });
  });
});
