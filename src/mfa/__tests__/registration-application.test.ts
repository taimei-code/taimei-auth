import { describe, expect, test } from "bun:test";
import { createRegistrationApplication } from "../registration/application";
import type { RegistrationPrincipal } from "../registration/contracts";
import type {
  GuardLease,
  RegistrationOperations,
  RegistrationSnapshot,
  TransitionGuard,
} from "../registration/ports";

const principal: RegistrationPrincipal = {
  userId: "user-1",
  email: "user@example.com",
  twoFactorEnabled: false,
};
const headers = new Headers();
const sessionChanges = new Headers([["set-cookie", "session=rotated"]]);
const pendingSnapshot: RegistrationSnapshot = {
  user: "present",
  email: principal.email,
  twoFactorEnabled: false,
  enrollment: { id: "enrollment-1", verified: false },
};

type HarnessOverrides = {
  operations?: Partial<RegistrationOperations>;
  release?: TransitionGuard["release"];
  notifyEnabled?: () => void;
  reportUnknownTransition?: () => void;
};

function createHarness(overrides: HarnessOverrides = {}) {
  const events: string[] = [];
  const lease: GuardLease = {
    userId: principal.userId,
    token: "guard-1",
    operation: "activate",
    snapshot: pendingSnapshot,
  };
  const guard: TransitionGuard = {
    acquire: async (_userId, operation) => {
      events.push(`acquire:${operation}`);
      return { acquired: true, lease: { ...lease, operation } };
    },
    release:
      overrides.release ??
      (async () => {
        events.push("release");
        return { released: true };
      }),
  };
  const operations: RegistrationOperations = {
    getStatus: async () => ({ enabled: false, inEffect: false, recoveryCodesRemaining: 0 }),
    enroll: async () => ({
      ok: true,
      enrollmentId: "enrollment-1",
      totpUri: "otpauth://totp/example",
      recoveryCodes: ["recovery-1"],
    }),
    restart: async () => ({
      ok: true,
      enrollmentId: "enrollment-2",
      totpUri: "otpauth://totp/example-2",
      recoveryCodes: ["recovery-2"],
    }),
    activate: async () => {
      events.push("activate");
      return { ok: true, sessionChanges, notifyEmail: principal.email };
    },
    disable: async () => {
      events.push("disable");
      return { ok: true, sessionChanges, notifyEmail: principal.email };
    },
    ...overrides.operations,
  };
  return {
    app: createRegistrationApplication({
      guard,
      operations,
      notifyEnabled: overrides.notifyEnabled ?? (() => events.push("notify:enabled")),
      notifyDisabled: () => events.push("notify:disabled"),
      reportUnknownTransition: overrides.reportUnknownTransition,
    }),
    events,
  };
}

describe("MFA registration application", () => {
  test("QA-H-06 releases the guard before scheduling an enabled notification", async () => {
    const { app, events } = createHarness();

    const result = await app.activate({
      principal,
      headers,
      enrollmentId: "enrollment-1",
      code: "123456",
    });

    expect(result).toEqual({ ok: true, sessionChanges });
    expect(events).toEqual(["acquire:activate", "activate", "release", "notify:enabled"]);
  });

  test("QA-M-02 leaves the guard and skips notification when an outcome is unknown", async () => {
    const { app, events } = createHarness({
      operations: {
        activate: async () => {
          events.push("activate");
          throw new Error("response lost after commit");
        },
      },
    });

    await expect(
      app.activate({
        principal,
        headers,
        enrollmentId: "enrollment-1",
        code: "123456",
      }),
    ).rejects.toThrow("response lost after commit");
    expect(events).toEqual(["acquire:activate", "activate"]);
  });

  test("QA-E-03 keeps the ID-less compatibility command outside the normal activate signature", async () => {
    const receivedIds: Array<string | undefined> = [];
    const { app } = createHarness({
      operations: {
        activate: async ({ enrollmentId }) => {
          receivedIds.push(enrollmentId);
          return { ok: true, sessionChanges, notifyEmail: principal.email };
        },
      },
    });

    await app.activateLegacy({ principal, headers, code: "123456" });
    await app.activate({ principal, headers, enrollmentId: "enrollment-1", code: "123456" });

    expect(receivedIds).toEqual([undefined, "enrollment-1"]);
  });

  test("QA-M-05 a notification adapter failure does not change a committed result", async () => {
    const originalError = console.error;
    console.error = () => undefined;
    const { app } = createHarness({
      notifyEnabled: () => {
        throw new Error("notification scheduler unavailable");
      },
    });

    try {
      expect(
        await app.activate({
          principal,
          headers,
          enrollmentId: "enrollment-1",
          code: "123456",
        }),
      ).toEqual({ ok: true, sessionChanges });
    } finally {
      console.error = originalError;
    }
  });

  test("keeps session changes and notification when only guard release fails", async () => {
    const { app, events } = createHarness({
      release: async () => {
        throw new Error("release failed");
      },
      reportUnknownTransition: () => events.push("report:release"),
    });

    expect(
      await app.activate({
        principal,
        headers,
        enrollmentId: "enrollment-1",
        code: "123456",
      }),
    ).toEqual({ ok: true, sessionChanges });
    expect(events).toEqual(["acquire:activate", "activate", "report:release", "notify:enabled"]);
  });
});
