import { describe, expect, test } from "bun:test";
import type { RegistrationOperationKind, TransitionGuard } from "../registration/ports";
import { createTransitionRunner } from "../registration/transition";

const lease = {
  userId: "user-1",
  token: "token-1",
  operation: "enroll" as const,
  snapshot: {
    user: "present" as const,
    email: "user@example.com",
    twoFactorEnabled: false,
    enrollment: undefined,
  },
};

const busy = {
  ok: false,
  error: "temporarily_unavailable",
  status: 503,
  retryAfterSeconds: 10,
} as const;

describe("MFA registration transition lifecycle", () => {
  test("QA-E-03 returns busy without starting an external effect", async () => {
    let workStarted = false;
    const guard: TransitionGuard = {
      acquire: async () => ({ acquired: false, cause: "held", heldSince: undefined }),
      release: async () => ({ released: false }),
    };

    const run = createTransitionRunner(guard);
    const result = await run("user-1", "enroll", async () => {
      workStarted = true;
      return "unexpected";
    });

    expect(result).toEqual(busy);
    expect(workStarted).toBe(false);
  });

  test("user_absent は busy でなく not_found で終端する (削除済み user に Retry-After を返さない)", async () => {
    const guard: TransitionGuard = {
      acquire: async () => ({ acquired: false, cause: "user_absent" }),
      release: async () => ({ released: false }),
    };

    const result = await createTransitionRunner(guard)("user-1", "enroll", async () => "unused");

    expect(result).toEqual({ ok: false, error: "not_found", status: 404 });
  });

  test("statement_timeout 由来の busy 化は phase:acquire で観測する", async () => {
    const reported: Array<{ phase: string }> = [];
    const guard: TransitionGuard = {
      acquire: async () => ({ acquired: false, cause: "timeout" }),
      release: async () => ({ released: false }),
    };

    const result = await createTransitionRunner(guard, (event) => reported.push(event))(
      "user-1",
      "enroll",
      async () => "unused",
    );

    expect(result).toEqual(busy);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.phase).toBe("acquire");
  });

  test("15 分を超えて残る guard は phase:acquire で滞留を観測する (解放はしない)", async () => {
    const reported: Array<{ phase: string; error: unknown }> = [];
    const heldSince = new Date(Date.now() - 16 * 60 * 1000);
    const guard: TransitionGuard = {
      acquire: async () => ({ acquired: false, cause: "held", heldSince }),
      release: async () => ({ released: false }),
    };

    const result = await createTransitionRunner(guard, (event) => reported.push(event))(
      "user-1",
      "disable",
      async () => "unused",
    );

    expect(result).toEqual(busy);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.phase).toBe("acquire");
    expect(String(reported[0]?.error)).toContain("stale");
  });

  test("滞留閾値内の held は観測せず busy のみ返す", async () => {
    const reported: unknown[] = [];
    const guard: TransitionGuard = {
      acquire: async () => ({
        acquired: false,
        cause: "held",
        heldSince: new Date(Date.now() - 1_000),
      }),
      release: async () => ({ released: false }),
    };

    const result = await createTransitionRunner(guard, (event) => reported.push(event))(
      "user-1",
      "disable",
      async () => "unused",
    );

    expect(result).toEqual(busy);
    expect(reported).toHaveLength(0);
  });

  test("QA-M-02 releases a known terminal result with the acquired token", async () => {
    const released: unknown[] = [];
    const guard: TransitionGuard = {
      acquire: async () => ({ acquired: true, lease }),
      release: async (value) => {
        released.push(value);
        return { released: true };
      },
    };

    const result = await createTransitionRunner(guard)("user-1", "enroll", async (snapshot) => {
      expect(snapshot).toEqual(lease.snapshot);
      return { ok: true };
    });

    expect(result).toEqual({ ok: true });
    expect(released).toEqual([lease]);
  });

  test("QA-M-09 leaves the guard when the outcome is unknown", async () => {
    let releaseCalls = 0;
    const guard: TransitionGuard = {
      acquire: async () => ({ acquired: true, lease }),
      release: async () => {
        releaseCalls += 1;
        return { released: true };
      },
    };

    const run = createTransitionRunner(guard);
    await expect(
      run("user-1", "enroll", async () => {
        throw new Error("connection lost after commit");
      }),
    ).rejects.toThrow("connection lost after commit");
    expect(releaseCalls).toBe(0);
  });

  test("QA-M-09 reports an unknown outcome without exposing user or token metadata", async () => {
    const reported: Array<{
      operation: RegistrationOperationKind;
      phase: "acquire" | "transition" | "release";
      error: unknown;
    }> = [];
    const failure = new Error("connection lost after commit");
    const guard: TransitionGuard = {
      acquire: async () => ({ acquired: true, lease }),
      release: async () => ({ released: true }),
    };

    const run = createTransitionRunner(guard, (event) => reported.push(event));
    await expect(
      run("user-1", "activate", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(reported).toEqual([{ operation: "activate", phase: "transition", error: failure }]);
  });

  test("keeps a terminal operation result when guard release is uncertain", async () => {
    const reported: Array<{
      operation: RegistrationOperationKind;
      phase: "acquire" | "transition" | "release";
      error: unknown;
    }> = [];
    const guard: TransitionGuard = {
      acquire: async () => ({ acquired: true, lease }),
      release: async () => {
        throw new Error("release response lost");
      },
    };
    const terminalResult = { ok: true as const, sessionChanges: "opaque-session-change" };

    const result = await createTransitionRunner(guard, (event) => reported.push(event))(
      "user-1",
      "activate",
      async () => terminalResult,
    );

    expect(result).toBe(terminalResult);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.operation).toBe("activate");
    expect(reported[0]?.phase).toBe("release");
  });

  test("QA-D-04 all write-operation pairs admit only one callback per user", async () => {
    const pairs: Array<[RegistrationOperationKind, RegistrationOperationKind]> = [
      ["enroll", "enroll"],
      ["enroll", "activate"],
      ["enroll", "disable"],
      ["activate", "activate"],
      ["activate", "disable"],
      ["disable", "disable"],
    ];

    for (const [firstOperation, secondOperation] of pairs) {
      let occupied = false;
      let firstStarted!: () => void;
      let finishFirst!: () => void;
      const started = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });
      const finishing = new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      const guard: TransitionGuard = {
        acquire: async (_userId, operation) => {
          if (occupied) return { acquired: false, cause: "held", heldSince: undefined };
          occupied = true;
          return { acquired: true, lease: { ...lease, operation } };
        },
        release: async () => {
          occupied = false;
          return { released: true };
        },
      };
      const run = createTransitionRunner(guard);
      const first = run("user-1", firstOperation, async () => {
        firstStarted();
        await finishing;
        return "first";
      });
      await started;
      let secondCallbacks = 0;

      const second = await run("user-1", secondOperation, async () => {
        secondCallbacks += 1;
        return "second";
      });

      expect(second).toEqual(busy);
      expect(secondCallbacks).toBe(0);
      finishFirst();
      expect(await first).toBe("first");
    }
  });
});
