import { describe, expect, test } from "bun:test";
import type { MfaFailure } from "../error-mapping";
import type { MfaActor } from "../registration/contracts";
import {
  createRegistrationFaultHarness,
  type RegistrationFault,
} from "./registration-fault-adapter";

const actor: MfaActor = {
  id: "user-1",
  email: "principal@example.com",
  twoFactorEnabled: false,
};

type Scenario = {
  id: string;
  description: string;
  operation: "activate" | "disable";
  fault?: RegistrationFault;
  expectedLedger: string[];
  expectedReturn?: { ok: true } | MfaFailure;
  expectedCookies?: string[];
  expectedNotifications?: string[];
  expectedReleasedHoldTokens?: string[];
  expectedHeldToken?: string;
  expectedTransitionReport?: boolean;
  expectedAuditObservation?: boolean;
};

const scenarios: Scenario[] = [
  {
    id: "A-S",
    description: "activate runs every effect before releasing and notifying",
    operation: "activate",
    expectedLedger: ["acquire", "revoke", "activateTotp", "audit", "release", "notifyEnabled"],
    expectedReturn: { ok: true },
    expectedCookies: ["activate-revoke=1", "activate-totp=1"],
    expectedNotifications: ["enabled:snapshot@example.com"],
    expectedReleasedHoldTokens: ["guard-activate"],
  },
  {
    id: "A-RK",
    description: "activate returns a known revoke failure and releases the hold",
    operation: "activate",
    fault: { step: "revoke", mode: "known" },
    expectedLedger: ["acquire", "revoke", "release"],
    expectedReturn: { ok: false, error: "challenge_expired", status: 401 },
    expectedReleasedHoldTokens: ["guard-activate"],
  },
  {
    id: "A-RT",
    description: "activate rethrows an unknown revoke outcome and keeps the hold",
    operation: "activate",
    fault: { step: "revoke", mode: "throw" },
    expectedLedger: ["acquire", "revoke"],
    expectedHeldToken: "guard-activate",
    expectedTransitionReport: true,
  },
  {
    id: "A-AK",
    description: "activate returns a known TOTP activation failure and releases the hold",
    operation: "activate",
    fault: { step: "activateTotp", mode: "known" },
    expectedLedger: ["acquire", "revoke", "activateTotp", "release"],
    expectedReturn: { ok: false, error: "invalid_code", status: 400 },
    expectedReleasedHoldTokens: ["guard-activate"],
  },
  {
    id: "A-AT",
    description: "activate rethrows an unknown TOTP activation outcome and keeps the hold",
    operation: "activate",
    fault: { step: "activateTotp", mode: "throw" },
    expectedLedger: ["acquire", "revoke", "activateTotp"],
    expectedHeldToken: "guard-activate",
    expectedTransitionReport: true,
  },
  {
    id: "A-AUD",
    description: "activate observes an audit throw without changing its success",
    operation: "activate",
    fault: { step: "audit", mode: "throw" },
    expectedLedger: [
      "acquire",
      "revoke",
      "activateTotp",
      "audit",
      "observeAudit",
      "release",
      "notifyEnabled",
    ],
    expectedReturn: { ok: true },
    expectedCookies: ["activate-revoke=1", "activate-totp=1"],
    expectedNotifications: ["enabled:snapshot@example.com"],
    expectedReleasedHoldTokens: ["guard-activate"],
    expectedAuditObservation: true,
  },
  {
    id: "D-S",
    description: "disable runs every effect before releasing and notifying",
    operation: "disable",
    expectedLedger: [
      "acquire",
      "spend",
      "verify",
      "reset",
      "revoke",
      "disableTotp",
      "audit",
      "release",
      "notifyDisabled",
    ],
    expectedReturn: { ok: true },
    expectedCookies: ["disable-verify=1", "disable-revoke=1", "disable-totp=1"],
    expectedNotifications: ["disabled:snapshot@example.com"],
    expectedReleasedHoldTokens: ["guard-disable"],
  },
  {
    id: "D-SK",
    description: "disable returns locked when spending the attempt fails",
    operation: "disable",
    fault: { step: "spend", mode: "known" },
    expectedLedger: ["acquire", "spend", "release"],
    expectedReturn: { ok: false, error: "locked", status: 429 },
    expectedReleasedHoldTokens: ["guard-disable"],
  },
  {
    id: "D-VK",
    description: "disable returns a known verification failure and releases the hold",
    operation: "disable",
    fault: { step: "verify", mode: "known" },
    expectedLedger: ["acquire", "spend", "verify", "release"],
    expectedReturn: { ok: false, error: "invalid_code", status: 400 },
    expectedReleasedHoldTokens: ["guard-disable"],
  },
  {
    id: "D-VT",
    description: "disable rethrows an unknown verification outcome and keeps the hold",
    operation: "disable",
    fault: { step: "verify", mode: "throw" },
    expectedLedger: ["acquire", "spend", "verify"],
    expectedHeldToken: "guard-disable",
    expectedTransitionReport: true,
  },
  {
    id: "D-RK",
    description: "disable returns a known revoke failure and releases the hold",
    operation: "disable",
    fault: { step: "revoke", mode: "known" },
    expectedLedger: ["acquire", "spend", "verify", "reset", "revoke", "release"],
    expectedReturn: { ok: false, error: "challenge_expired", status: 401 },
    expectedReleasedHoldTokens: ["guard-disable"],
  },
  {
    id: "D-RT",
    description: "disable rethrows an unknown revoke outcome and keeps the hold",
    operation: "disable",
    fault: { step: "revoke", mode: "throw" },
    expectedLedger: ["acquire", "spend", "verify", "reset", "revoke"],
    expectedHeldToken: "guard-disable",
    expectedTransitionReport: true,
  },
  {
    id: "D-DK",
    description: "disable returns a known TOTP disable failure and releases the hold",
    operation: "disable",
    fault: { step: "disableTotp", mode: "known" },
    expectedLedger: ["acquire", "spend", "verify", "reset", "revoke", "disableTotp", "release"],
    expectedReturn: { ok: false, error: "challenge_expired", status: 401 },
    expectedReleasedHoldTokens: ["guard-disable"],
  },
  {
    id: "D-DT",
    description: "disable rethrows an unknown TOTP disable outcome and keeps the hold",
    operation: "disable",
    fault: { step: "disableTotp", mode: "throw" },
    expectedLedger: ["acquire", "spend", "verify", "reset", "revoke", "disableTotp"],
    expectedHeldToken: "guard-disable",
    expectedTransitionReport: true,
  },
  {
    id: "D-AUD",
    description: "disable observes an audit throw without changing its success",
    operation: "disable",
    fault: { step: "audit", mode: "throw" },
    expectedLedger: [
      "acquire",
      "spend",
      "verify",
      "reset",
      "revoke",
      "disableTotp",
      "audit",
      "observeAudit",
      "release",
      "notifyDisabled",
    ],
    expectedReturn: { ok: true },
    expectedCookies: ["disable-verify=1", "disable-revoke=1", "disable-totp=1"],
    expectedNotifications: ["disabled:snapshot@example.com"],
    expectedReleasedHoldTokens: ["guard-disable"],
    expectedAuditObservation: true,
  },
];

describe("MFA registration partial failures", () => {
  for (const scenario of scenarios) {
    test(`${scenario.id}: ${scenario.description}`, async () => {
      const harness = createRegistrationFaultHarness({
        operation: scenario.operation,
        fault: scenario.fault,
      });
      let returned: { ok: true } | MfaFailure | undefined;
      let thrown: unknown;
      let cookies: string[] = [];

      try {
        const result =
          scenario.operation === "activate"
            ? await harness.app.activate({
                actor,
                headers: new Headers(),
                enrollmentId: "enrollment-1",
                code: "123456",
              })
            : await harness.app.disable({
                actor,
                headers: new Headers(),
                code: "123456",
                kind: "totp",
              });
        returned = result.ok ? { ok: true } : result;
        cookies = result.ok ? result.sessionChanges.getSetCookie() : [];
      } catch (error) {
        thrown = error;
      }

      if (scenario.expectedReturn === undefined) {
        expect(returned).toBeUndefined();
        expect(thrown).toBe(harness.faultError);
      } else {
        expect(thrown).toBeUndefined();
        expect(returned).toEqual(scenario.expectedReturn);
      }
      expect(harness.ledger).toEqual(scenario.expectedLedger);
      expect(cookies).toEqual(scenario.expectedCookies ?? []);
      expect(harness.notifications).toEqual(scenario.expectedNotifications ?? []);
      expect(harness.releasedHolds.map((hold) => hold.token)).toEqual(
        scenario.expectedReleasedHoldTokens ?? [],
      );
      expect(harness.activeHold?.token).toBe(scenario.expectedHeldToken);

      expect(
        harness.transitionReports.map(({ operation, phase }) => ({ operation, phase })),
      ).toEqual(
        scenario.expectedTransitionReport
          ? [{ operation: scenario.operation, phase: "transition" }]
          : [],
      );
      if (scenario.expectedTransitionReport) {
        expect(harness.transitionReports[0]?.error).toBe(harness.faultError);
      }

      expect(harness.observedAuditErrors.length).toBe(scenario.expectedAuditObservation ? 1 : 0);
      if (scenario.expectedAuditObservation) {
        expect(harness.observedAuditErrors[0]).toBe(harness.faultError);
      }
    });
  }

  for (const operation of ["activate", "disable"] as const) {
    test(`QA-E-01: ${operation} rejects an absent-user snapshot before operation effects`, async () => {
      const harness = createRegistrationFaultHarness({
        operation,
        snapshot: { user: "absent" },
      });

      const result =
        operation === "activate"
          ? await harness.app.activate({
              actor,
              headers: new Headers(),
              enrollmentId: "enrollment-1",
              code: "123456",
            })
          : await harness.app.disable({
              actor,
              headers: new Headers(),
              code: "123456",
              kind: "totp",
            });

      expect(result).toEqual(
        operation === "activate"
          ? { ok: false, error: "not_found", status: 404 }
          : { ok: false, error: "not_enabled", status: 409 },
      );
      expect(harness.ledger).toEqual(["acquire", "release"]);
      expect(harness.notifications).toEqual([]);
    });
  }

  test("QA-D-02: an unknown outcome keeps the guard and rejects reacquisition", async () => {
    const harness = createRegistrationFaultHarness({
      operation: "activate",
      fault: { step: "revoke", mode: "throw" },
    });
    const command = {
      actor,
      headers: new Headers(),
      enrollmentId: "enrollment-1",
      code: "123456",
    };

    await expect(harness.app.activate(command)).rejects.toBe(harness.faultError);
    expect(await harness.app.activate(command)).toEqual({
      ok: false,
      error: "temporarily_unavailable",
      status: 503,
      retryAfterSeconds: 10,
    });
    expect(harness.ledger).toEqual(["acquire", "revoke", "acquire"]);
    expect(harness.activeHold?.token).toBe("guard-activate");
  });

  // AC-009 (runner 側): enroll replay の readPending が既知の失敗を返すと guard は解放される
  // (known 限定の理由の正本: ADR-0013 §8)。
  test("E-S: enroll replay reads the pending enrollment and releases the hold", async () => {
    const harness = createRegistrationFaultHarness({ operation: "enroll" });

    const result = await harness.app.enroll({ actor, headers: new Headers() });

    expect(result).toEqual({
      ok: true,
      enrollmentId: "enrollment-1",
      totpUri: "otpauth://fake",
      recoveryCodes: ["code-1"],
    });
    expect(harness.ledger).toEqual(["acquire", "readPending", "release"]);
    expect(harness.activeHold).toBeUndefined();
  });

  test("E-RPK: a known readPending failure releases the hold (AC-009)", async () => {
    const harness = createRegistrationFaultHarness({
      operation: "enroll",
      fault: { step: "readPending", mode: "known" },
    });

    const result = await harness.app.enroll({ actor, headers: new Headers() });

    expect(result).toEqual({ ok: false, error: "challenge_expired", status: 401 });
    expect(harness.ledger).toEqual(["acquire", "readPending", "release"]);
    expect(harness.activeHold).toBeUndefined();
    expect(harness.transitionReports).toEqual([]);
  });
});
