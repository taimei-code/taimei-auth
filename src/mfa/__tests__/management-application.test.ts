import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  acquireRegistrationGuard,
  readRegistrationGuardProtocolVersion,
  releaseRegistrationGuard,
  releaseRegistrationGuardByManagement,
} from "@/db/repositories/mfa-registration";
import { findUserById } from "@/db/repositories/user";
import { auditRowsFor, createSeedHelpers } from "../../handlers/__tests__/helpers";
import { forceDisableMfa, type ForceDisableResult } from "../registration/force-disable";
import { createManagementApplication } from "../registration/management";
import type {
  AcquireRegistrationGuardResult,
  GuardHold,
  RegistrationSnapshot,
  TransitionGuard,
} from "../registration/ports";
import { reportUnknownMfaRegistrationTransition } from "../registration/observability-adapter";
import { managementApplication, registrationGuard } from "../registration/wiring";
import { countTwoFactorRows, enableMfaFor } from "./helpers";

const presentSnapshot: RegistrationSnapshot = {
  user: "present",
  email: "snapshot@example.com",
  twoFactorEnabled: false,
  enrollment: undefined,
};

const hold: GuardHold = {
  userId: "user-1",
  token: "guard-1",
  operation: "force_disable",
  snapshot: presentSnapshot,
};

type HarnessOptions = {
  protocolVersion?: number | undefined;
  findUserById?: () => Promise<{ id: string } | undefined>;
  acquire?: () => Promise<AcquireRegistrationGuardResult>;
  release?: TransitionGuard["release"];
  forceDisableOperation?: (
    userId: string,
    snapshot: RegistrationSnapshot,
  ) => Promise<ForceDisableResult>;
  releaseGuardByManagement?: () => Promise<{ released: boolean }>;
  notifyDisabled?: (email: string) => Promise<boolean>;
};

// dep 呼び出しの記録は harness が一元で行う。個々の test の override は挙動の差分だけを書き、
// events / notificationEmails の維持を再実装しない。
function createHarness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const reports: Array<{ operation: string; phase: string; error: unknown }> = [];
  const notificationEmails: string[] = [];
  const instrument =
    <A extends unknown[], R>(label: string, fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      events.push(label);
      return fn(...args);
    };
  const notifyDisabled = options.notifyDisabled ?? (async () => true);
  const app = createManagementApplication({
    guard: {
      acquire: instrument("acquire", options.acquire ?? (async () => ({ acquired: true, hold }))),
      release: instrument("release", options.release ?? (async () => ({ released: true }))),
    },
    reportUnknownTransition: (event) => {
      events.push(`report:${event.phase}`);
      reports.push(event);
    },
    // ?? 1 にしない: 明示した undefined は「protocol version 未設定の DB」の再現で、正常値 1 に
    // 畳んではならない。未指定の時だけ正常系の 1 を返す。
    readProtocolVersion: instrument("protocol", async () =>
      "protocolVersion" in options ? options.protocolVersion : 1,
    ),
    findUserById: instrument("find-user", options.findUserById ?? (async () => ({ id: "user-1" }))),
    forceDisableOperation: instrument(
      "operation",
      options.forceDisableOperation ?? (async () => ({ ok: true, changed: false })),
    ),
    releaseGuardByManagement: instrument(
      "release-management",
      options.releaseGuardByManagement ?? (async () => ({ released: true })),
    ),
    notifyDisabled: instrument("notify", async (email: string) => {
      notificationEmails.push(email);
      return notifyDisabled(email);
    }),
  });
  return { app, events, reports, notificationEmails };
}

const notFound = { ok: false, error: "not_found", status: 404 } as const;
const busy = {
  ok: false,
  error: "temporarily_unavailable",
  status: 503,
  retryAfterSeconds: 10,
} as const;

describe("management application protocol and validation", () => {
  for (const scenario of [
    { version: undefined, displayed: "missing" },
    { version: 2, displayed: "2" },
  ] as const) {
    test(`forceDisable rejects protocol ${scenario.displayed} before effects`, async () => {
      const { app, events } = createHarness({ protocolVersion: scenario.version });

      await expect(app.forceDisable("user-1")).rejects.toThrow(
        `MFA registration guard protocol mismatch: expected 1, got ${scenario.displayed}`,
      );
      expect(events).toEqual(["protocol"]);
    });

    test(`forceReleaseRegistrationGuard rejects protocol ${scenario.displayed} before repository`, async () => {
      const { app, events } = createHarness({ protocolVersion: scenario.version });

      await expect(
        app.forceReleaseRegistrationGuard({
          userId: "user-1",
          source: "management/test",
          reason: "incident",
          processStoppedConfirmed: true,
        }),
      ).rejects.toThrow(
        `MFA registration guard protocol mismatch: expected 1, got ${scenario.displayed}`,
      );
      expect(events).toEqual(["protocol"]);
    });
  }

  for (const scenario of [
    { source: " ", reason: "incident", processStoppedConfirmed: true },
    { source: "management/test", reason: " ", processStoppedConfirmed: true },
    { source: "management/test", reason: "incident", processStoppedConfirmed: false },
  ] as const) {
    test(`invalid release confirmation returns before dependencies: ${JSON.stringify(scenario)}`, async () => {
      const { app, events } = createHarness();

      expect(await app.forceReleaseRegistrationGuard({ userId: "user-1", ...scenario })).toEqual({
        ok: false,
        reason: "invalid_release_confirmation",
      });
      expect(events).toEqual([]);
    });
  }
});

describe("management forceDisable failure vocabulary", () => {
  test("pre-check absence and acquired absent snapshot are identical", async () => {
    const precheck = createHarness({ findUserById: async () => undefined });
    const snapshot = createHarness({
      acquire: async () => ({ acquired: true, hold: { ...hold, snapshot: { user: "absent" } } }),
      forceDisableOperation: forceDisableMfa,
    });

    const precheckResult = await precheck.app.forceDisable("user-1");
    const snapshotResult = await snapshot.app.forceDisable("user-1");

    expect(precheckResult).toEqual(notFound);
    // AC-03: 2 経路の返り値が同一であることを比較で固定する。
    expect(snapshotResult).toEqual(precheckResult);
  });

  test("pre-check success followed by guard user_absent returns the same not_found", async () => {
    const precheck = createHarness({ findUserById: async () => undefined });
    const raced = createHarness({
      acquire: async () => ({ acquired: false, cause: "user_absent" }),
    });

    const precheckResult = await precheck.app.forceDisable("user-1");
    const racedResult = await raced.app.forceDisable("user-1");

    // pre-check 通過後に user が消えた race も同じ not_found 語彙に畳まれる。
    expect(racedResult).toEqual(notFound);
    expect(racedResult).toEqual(precheckResult);
  });

  test("held guard returns busy without notification", async () => {
    const { app, notificationEmails } = createHarness({
      acquire: async () => ({ acquired: false, cause: "held", heldSince: undefined }),
    });

    expect(await app.forceDisable("user-1")).toEqual(busy);
    expect(notificationEmails).toEqual([]);
  });

  test("unknown operation outcome leaves the guard and the next call is busy", async () => {
    const failure = new Error("response lost after commit");
    let held = false;
    let releaseCalls = 0;
    const { app } = createHarness({
      acquire: async () => {
        if (held) return { acquired: false, cause: "held", heldSince: new Date() };
        held = true;
        return { acquired: true, hold };
      },
      release: async () => {
        releaseCalls += 1;
        held = false;
        return { released: true };
      },
      forceDisableOperation: async () => {
        throw failure;
      },
    });

    await expect(app.forceDisable("user-1")).rejects.toBe(failure);
    expect(releaseCalls).toBe(0);
    expect(await app.forceDisable("user-1")).toEqual(busy);
  });
});

describe("management forceDisable completion lifecycle", () => {
  for (const releaseOutcome of ["false", "throw"] as const) {
    test(`release ${releaseOutcome} preserves terminal result and reports release`, async () => {
      const { app, reports } = createHarness({
        release: async () => {
          if (releaseOutcome === "throw") throw new Error("release failed");
          return { released: false };
        },
      });

      expect(await app.forceDisable("user-1")).toEqual({ ok: true, changed: false });
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ operation: "force_disable", phase: "release" });
    });
  }

  test("release happens before notification and email stays inside the façade", async () => {
    const { app, events, notificationEmails } = createHarness({
      forceDisableOperation: async () => ({
        ok: true,
        changed: true,
        notifyEmail: "person@example.com",
      }),
    });

    const result = await app.forceDisable("user-1");

    expect(result).toEqual({ ok: true, changed: true, notified: true });
    expect("notifyEmail" in result).toBe(false);
    expect(events).toEqual(["protocol", "find-user", "acquire", "operation", "release", "notify"]);
    expect(notificationEmails).toEqual(["person@example.com"]);
  });

  test("notification false does not change committed success", async () => {
    const { app } = createHarness({
      forceDisableOperation: async () => ({
        ok: true,
        changed: true,
        notifyEmail: "person@example.com",
      }),
      notifyDisabled: async () => false,
    });

    expect(await app.forceDisable("user-1")).toEqual({
      ok: true,
      changed: true,
      notified: false,
    });
  });

  test("notification rejection does not change committed success", async () => {
    const { app } = createHarness({
      forceDisableOperation: async () => ({
        ok: true,
        changed: true,
        notifyEmail: "person@example.com",
      }),
      notifyDisabled: async () => {
        throw new Error("notification transport down");
      },
    });

    expect(await app.forceDisable("user-1")).toEqual({
      ok: true,
      changed: true,
      notified: false,
    });
  });

  test.each([
    [true, { ok: true, released: true }],
    [false, { ok: true, released: false }],
  ] as const)("release repository result %s is transparent", async (released, expected) => {
    const { app } = createHarness({ releaseGuardByManagement: async () => ({ released }) });

    expect(
      await app.forceReleaseRegistrationGuard({
        userId: "user-1",
        source: " management/test ",
        reason: " incident ",
        processStoppedConfirmed: true,
      }),
    ).toEqual(expected);
  });
});

const P = "mfa-management-app-";
const { cleanup, seedUser } = createSeedHelpers(P);

function createDbApplication({ notificationDelivered = true } = {}) {
  const notificationEmails: string[] = [];
  return {
    // guard は wiring の registrationGuard を共有する。二重定義だと production 側だけに
    // wrapper が入った時、統合テストが旧結線のまま green に留まる。
    app: createManagementApplication({
      guard: registrationGuard,
      reportUnknownTransition: reportUnknownMfaRegistrationTransition,
      readProtocolVersion: readRegistrationGuardProtocolVersion,
      findUserById,
      forceDisableOperation: forceDisableMfa,
      releaseGuardByManagement: releaseRegistrationGuardByManagement,
      notifyDisabled: async (email) => {
        notificationEmails.push(email);
        return notificationDelivered;
      },
    }),
    notificationEmails,
  };
}

// 3 つの観測は互いに独立なので直列に 1 往復ずつ読まない。
async function mfaDisableState(userId: string) {
  const [rows, user, audits] = await Promise.all([
    countTwoFactorRows(userId),
    findUserById(userId),
    auditRowsFor(userId, "mfa_disabled"),
  ]);
  return { rows, enabled: user?.twoFactorEnabled, audits };
}

describe("management application DB integration", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("enabled user is disabled, audited, and notified through the façade", async () => {
    const user = await seedUser("enabled");
    await enableMfaFor(user);
    const { app, notificationEmails } = createDbApplication();

    expect(await app.forceDisable(user.id)).toEqual({
      ok: true,
      changed: true,
      notified: true,
    });
    expect(await mfaDisableState(user.id)).toEqual({
      rows: 0,
      enabled: false,
      audits: [
        expect.objectContaining({
          payload: { ip: null, userAgent: "management/disable-user-mfa" },
        }),
      ],
    });
    expect(notificationEmails).toEqual([user.email]);
  });

  test("disabled user is idempotent without audit or notification", async () => {
    const user = await seedUser("disabled");
    const { app, notificationEmails } = createDbApplication();
    const auditCountBefore = (await auditRowsFor(user.id, "mfa_disabled")).length;

    expect(await app.forceDisable(user.id)).toEqual({ ok: true, changed: false });
    expect(notificationEmails).toEqual([]);
    expect((await auditRowsFor(user.id, "mfa_disabled")).length).toBe(auditCountBefore);
  });

  test("held guard returns busy without changing DB state", async () => {
    const user = await seedUser("held");
    await enableMfaFor(user);
    const acquired = await acquireRegistrationGuard(user.id, "force_disable");
    if (!acquired.acquired) throw new Error("test guard was not acquired");
    const { app, notificationEmails } = createDbApplication();
    const before = await mfaDisableState(user.id);

    try {
      expect(await app.forceDisable(user.id)).toEqual(busy);
      expect(await mfaDisableState(user.id)).toEqual(before);
      expect(notificationEmails).toEqual([]);
    } finally {
      await releaseRegistrationGuard(acquired.hold);
    }
  });

  test("notification false keeps the committed disabled state", async () => {
    const user = await seedUser("notify-false");
    await enableMfaFor(user);
    const { app } = createDbApplication({ notificationDelivered: false });

    expect(await app.forceDisable(user.id)).toEqual({
      ok: true,
      changed: true,
      notified: false,
    });
    expect(await mfaDisableState(user.id)).toMatchObject({ rows: 0, enabled: false });
  });
});

test("production wiring exports the bound management application", () => {
  expect(managementApplication).toEqual({
    forceDisable: expect.any(Function),
    forceReleaseRegistrationGuard: expect.any(Function),
  });
});
